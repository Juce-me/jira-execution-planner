from copy import deepcopy
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from flask import has_request_context, session as flask_session
from backend.epm.home import EPM_HOME_READ_SCOPES
from tests.db_oauth_test_helpers import seed_db_actor, FULL_OAUTH_SCOPE
from backend.db import engine as db_engine
from backend.db import models
from backend.services.user_view_config import UserViewConfigStorageError
from tests.auth_mode_test_utils import force_db_oauth_mode

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
        force_db_oauth_mode(self, jira_server)
        self.app = jira_server.app
        self.app.testing = True
        self.client = self.app.test_client()
        self.context = jira_server.current_request_auth_context()
        self.addCleanup(self.clear_fixture_caches)

    def clear_fixture_caches(self):
        for cache in (jira_server.EPM_PROJECTS_CACHE, jira_server.EPM_ISSUES_CACHE, jira_server.EPM_ROLLUP_CACHE):
            cache.clear()

    def seed_private_epm(self, settings, context=None):
        context = context or self.context
        with db_engine.session_scope() as db:
            row = db.query(models.ViewConfig).filter_by(workspace_id=context.workspace_id,
                owner_user_id=context.user_id, is_default=True).one_or_none()
            payload = deepcopy(row.payload) if row is not None else {}
            payload['epm'] = {**settings, 'viewEnabled': True}
            if row is None:
                db.add(models.ViewConfig(workspace_id=context.workspace_id, owner_user_id=context.user_id,
                    name='Synthetic private view', view_type='mixed', is_default=True, payload=payload))
            else:
                row.payload = payload

    def real_actors(self):
        actors = []
        with db_engine.session_scope() as db:
            for account, cloud in (('private-user-0', 'private-cloud-0'),
                                   ('private-user-1', 'private-cloud-0'),
                                   ('private-user-0', 'private-cloud-1')):
                actors.append(seed_db_actor(db, account_identity=account,
                    workspace={'environment_key': 'local', 'cloud_id': cloud,
                               'site_url': f'https://{cloud}.example.net'},
                    token_data={'scope': FULL_OAUTH_SCOPE + ' ' + ' '.join(EPM_HOME_READ_SCOPES)}))
        return actors

    def real_context(self, actor):
        with self.app.test_request_context('/'):
            flask_session['db_oauth_session'] = actor.session_payload
            return jira_server.current_request_auth_context()

    def actor_client(self, actor):
        client = self.app.test_client()
        with client.session_transaction() as cookie:
            cookie['db_oauth_session'] = actor.session_payload
        return client

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
        self.seed_private_epm({'version': 2, 'labelPrefix': 'private_*',
            'scope': {'rootGoalKey': 'ROOT-1', 'subGoalKeys': []},
            'issueTypes': self.DEFAULT_ISSUE_TYPES, 'projects': {}})
        payload = jira_server.get_epm_config(context=self.context)
        self.assertEqual(payload['labelPrefix'], 'private_*')

    def test_db_epm_resolver_reads_seeded_private_defaults_by_user_and_workspace(self):
        actors = self.real_actors()
        contexts = [self.real_context(actor) for actor in actors]
        for index, context in enumerate(contexts):
            self.seed_private_epm({'version': 2, 'labelPrefix': f'private_{index}_*',
                'scope': {'rootGoalKey': f'ROOT-{index}', 'subGoalKeys': [f'GOAL-{index}']},
                'issueTypes': self.DEFAULT_ISSUE_TYPES, 'projects': {}}, context)
        loaded = [jira_server.get_epm_config(context=context) for context in contexts]
        with self.app.test_request_context('/api/epm/projects/rollup/all'):
            flask_session['db_oauth_session'] = actors[0].session_payload
            projects_dependencies = jira_server.build_epm_projects_dependencies()
            rollup_dependencies = jira_server.build_epm_rollup_dependencies()

        def inspect_captured_worker_dependencies():
            return {'hasRequestContext': has_request_context(),
                'projectsConfig': projects_dependencies.get_epm_config(),
                'projectsDigest': projects_dependencies.config_generation,
                'rollupConfig': rollup_dependencies.get_epm_config(),
                'rollupDigest': rollup_dependencies.config_generation}

        with ThreadPoolExecutor(max_workers=1) as executor:
            captured = executor.submit(inspect_captured_worker_dependencies).result()
        with patch.object(jira_server, 'has_request_context', return_value=False):
            with self.assertRaises(jira_server.ConfigStorageError):
                jira_server.get_epm_config()
        self.assertEqual([item['labelPrefix'] for item in loaded], [
            'private_0_*', 'private_1_*', 'private_2_*'])
        self.assertFalse(captured['hasRequestContext'])
        self.assertEqual(captured['projectsConfig']['labelPrefix'], 'private_0_*')
        self.assertEqual(captured['rollupConfig']['labelPrefix'], 'private_0_*')
        digest = jira_server.build_epm_config_generation(loaded[0])
        self.assertEqual(captured['projectsDigest'], digest)
        self.assertEqual(captured['rollupDigest'], digest)

    def test_runtime_routes_isolate_real_private_defaults_by_user_and_workspace(self):
        from backend.routes import auth_routes
        actors = self.real_actors()
        contexts = [self.real_context(actor) for actor in actors]
        for index, context in enumerate(contexts):
            self.seed_private_epm({'version': 2, 'labelPrefix': f'route_private_{index}_*',
                'scope': {'rootGoalKey': f'ROOT-{index}', 'subGoalKeys': [f'GOAL-{index}']},
                'issueTypes': self.DEFAULT_ISSUE_TYPES,
                'projects': {f'custom-{index}': {'id': f'custom-{index}',
                    'name': f'Private Project {index}', 'label': f'private_label_{index}'}}}, context)
        with patch.dict('os.environ', {'ALLOW_DEV_DIAGNOSTIC_ENDPOINTS': 'true'}, clear=False), \
             patch.object(jira_server, 'fetch_epm_home_projects', return_value=[]), \
             patch.object(jira_server, 'fetch_home_site_cloud_id', return_value='detected-cloud'), \
             patch.object(jira_server, 'fetch_issues_by_jql', return_value=[]), \
             patch.object(jira_server, 'fetch_epm_rollup_query', return_value=[]), \
             patch.object(jira_server, 'resolve_epic_link_field_id', return_value=None), \
             patch.object(jira_server, 'resolve_team_field_id', return_value=None), \
             patch.object(jira_server, 'filter_epm_projects_for_tab', side_effect=lambda projects, _tab: projects), \
             patch('backend.epm.projects.filter_epm_projects_for_tab', side_effect=lambda projects, _tab, **_kwargs: projects):
            for index, actor in enumerate(actors):
                client = self.actor_client(actor)
                project_id = f'custom-{index}'
                with self.subTest(index=index):
                    scope = client.get('/api/epm/scope')
                    self.assertEqual(scope.status_code, 200, scope.get_data(as_text=True))
                    self.assertEqual(scope.get_json()['scope']['rootGoalKey'], f'ROOT-{index}')
                    for path in ('/api/epm/projects',
                        f'/api/epm/projects/{project_id}/issues?tab=backlog',
                        f'/api/epm/projects/{project_id}/rollup?tab=backlog',
                        '/api/epm/projects/rollup/all?tab=backlog'):
                        response = client.get(path)
                        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                        self.assertIn(f'Private Project {index}', response.get_data(as_text=True))
                    with patch.object(auth_routes.epm_home, 'run_home_graphql_oauth_probe', return_value={'ok': True}) as probe:
                        response = client.get('/api/auth/dev/home-graphql-oauth-probe')
                    self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                    probe.assert_called_once()
                    self.assertEqual(probe.call_args.kwargs['root_goal_key'], f'ROOT-{index}')
                    self.assertEqual(probe.call_args.kwargs['sub_goal_key'], f'GOAL-{index}')
                    self.assertEqual(probe.call_args.args[0], 'synthetic-access-' + ('private-user-1' if index == 1 else 'private-user-0'))

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

    def test_private_db_epm_read_failure_returns_fixed_storage_error(self):
        with patch('backend.services.user_view_config.load_user_epm_config',
                   side_effect=UserViewConfigStorageError('sensitive DB detail')):
            response = self.client.get('/api/epm/config')
        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {'error': 'config_storage_unavailable',
            'message': 'EPM configuration storage is unavailable.'})
        self.assertNotIn('sensitive', response.get_data(as_text=True))

    def test_private_db_epm_write_failure_returns_fixed_storage_error(self):
        payload = {'version': 2, 'labelPrefix': 'rnd_project_',
            'scope': {'rootGoalKey': '', 'subGoalKeys': []},
            'issueTypes': self.DEFAULT_ISSUE_TYPES, 'projects': {}}
        with patch('backend.services.user_view_config.save_user_epm_config',
                   side_effect=UserViewConfigStorageError('sensitive DB detail')):
            response = self.client.post('/api/epm/config', json=payload)
        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json(), {'error': 'config_storage_unavailable',
            'message': 'EPM configuration storage is unavailable.'})
        self.assertNotIn('sensitive', response.get_data(as_text=True))

    def test_get_epm_config_ignores_legacy_cloud_id_scope(self):
        self.seed_private_epm(({
                    'version': 1,
                    'epm': {
                        'version': 1,
                        'scope': {
                            'cloudId': ' legacy-cloud-123 ',
                            'subGoalKey': ' child-200 ',
                        },
                        'projects': {},
                    },
                })['epm'])

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
        self.seed_private_epm(({
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
                })['epm'])

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

    def test_db_main_config_include_view_config_preserves_saved_epm(self):
        saved_epm = {
            'version': 2,
            'labelPrefix': 'private_json_*',
            'scope': {'rootGoalKey': 'ROOT-JSON', 'subGoalKeys': ['GOAL-JSON']},
            'issueTypes': self.DEFAULT_ISSUE_TYPES,
            'projects': {},
        }
        self.seed_private_epm(({'version': 1, 'epm': saved_epm})['epm'])

        response = self.client.get('/api/config?includeViewConfig=true')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['epm'], saved_epm)
        self.assertEqual(response.get_json()['viewConfig']['view']['epm']['labelPrefix'], saved_epm['labelPrefix'])

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
        self.seed_private_epm(({
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
                })['epm'])

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

    def post_and_assert_actor_cache_eviction(self, payload):
        with db_engine.session_scope() as db:
            other_actor = seed_db_actor(db, workspace=db.get(models.Workspace, self.context.workspace_id),
                                       account_identity='other-cache-user')
        other = self.real_context(other_actor)
        self.seed_private_epm({'version': 2, 'labelPrefix': 'other_user_*',
            'scope': {'rootGoalKey': 'ROOT-OTHER', 'subGoalKeys': []},
            'issueTypes': self.DEFAULT_ISSUE_TYPES, 'projects': {}}, other)
        other_settings = jira_server.get_epm_config(context=other)
        own_keys = [jira_server.build_jira_home_process_cache_key(self.context, name)
                    for name in ('old-scope', 'old-other-scope')]
        other_key = jira_server.build_jira_home_process_cache_key(other, 'other-user-scope')
        caches = {key: {'value': index} for index, key in enumerate(own_keys + [other_key])}
        with patch.object(jira_server, 'EPM_PROJECTS_CACHE', deepcopy(caches)), \
             patch.object(jira_server, 'EPM_ISSUES_CACHE', deepcopy(caches)), \
             patch.object(jira_server, 'EPM_ROLLUP_CACHE', deepcopy(caches)), \
             patch.object(jira_server, 'TASKS_CACHE', {'unrelated-task': {'value': 3}}):
            response = self.client.post('/api/epm/config', json=payload)
            self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
            for cache in (jira_server.EPM_PROJECTS_CACHE, jira_server.EPM_ISSUES_CACHE, jira_server.EPM_ROLLUP_CACHE):
                self.assertEqual(cache, {other_key: caches[other_key]})
            self.assertEqual(jira_server.TASKS_CACHE, {'unrelated-task': {'value': 3}})
        self.assertEqual(jira_server.get_epm_config(context=other), other_settings)
        return response.get_json()

    def test_post_epm_config_persists_projects_without_overwriting_shared_or_private_state(self):
        self.seed_private_epm({'version': 2, 'labelPrefix': 'rnd_project_',
            'scope': {'rootGoalKey': 'ROOT-100', 'subGoalKeys': ['CHILD-200']}, 'projects': {},
            'tab': 'backlog', 'selectedSprint': '2027Q1'})
        groups_payload = {'version': 2, 'groups': [{'id': 'group-a', 'name': 'Group A', 'teamIds': ['team-a']}],
                          'defaultGroupId': 'group-a'}
        with db_engine.session_scope() as db:
            db.add(models.WorkspaceGroupConfig(workspace_id=self.context.workspace_id, payload=groups_payload))
            shared_before = deepcopy(db.query(models.WorkspaceDashboardConfig).one().payload)
        payload = self.post_and_assert_actor_cache_eviction({
            'version': 2, 'labelPrefix': 'rnd_project_',
            'scope': {'rootGoalKey': ' root-100 ', 'subGoalKeys': [' child-200 ']},
            'issueTypes': self.DEFAULT_ISSUE_TYPES,
            'projects': {'tsq-1': {'id': 'tsq-1', 'homeProjectId': ' tsq-1 ',
                'name': ' Synthetic Launch ', 'label': ' synthetic_label_alpha '}}})
        self.assertEqual(payload['version'], 2)
        self.assertEqual(payload['labelPrefix'], 'rnd_project_')
        self.assertEqual(payload['scope'], {'rootGoalKey': 'ROOT-100', 'subGoalKeys': ['CHILD-200']})
        self.assertEqual(payload['issueTypes'], self.DEFAULT_ISSUE_TYPES)
        self.assertEqual(payload['projects']['tsq-1'], {'id': 'tsq-1', 'homeProjectId': 'tsq-1',
            'name': 'Synthetic Launch', 'label': 'synthetic_label_alpha'})
        with db_engine.session_scope() as db:
            self.assertEqual(db.query(models.WorkspaceDashboardConfig).one().payload, shared_before)
            self.assertEqual(db.query(models.WorkspaceGroupConfig).one().payload, groups_payload)
            private_view = db.query(models.ViewConfig).filter_by(owner_user_id=self.context.user_id,
                workspace_id=self.context.workspace_id, is_default=True).one()
            private = private_view.payload['epm']
            self.assertEqual(payload['viewConfigId'], private_view.id)
            settings = {key: payload[key] for key in ('version', 'labelPrefix', 'scope', 'issueTypes', 'projects')}
            self.assertEqual(private, {**settings, 'viewEnabled': True,
                                      'tab': 'backlog', 'selectedSprint': '2027Q1'})
            self.assertNotIn('jiraEpicKey', private['projects']['tsq-1'])

    def test_post_epm_config_clears_only_actors_project_cache_when_scope_is_added(self):
        self.post_and_assert_actor_cache_eviction({'version': 2,
            'scope': {'rootGoalKey': 'ROOT-NEW', 'subGoalKeys': ['CHILD-NEW']},
            'labelPrefix': 'rnd_project_', 'issueTypes': self.DEFAULT_ISSUE_TYPES, 'projects': {}})

    def test_post_epm_config_clears_only_actors_project_cache_when_scope_changes(self):
        self.seed_private_epm({'version': 2, 'labelPrefix': 'rnd_project_',
            'scope': {'rootGoalKey': 'ROOT-OLD', 'subGoalKeys': ['CHILD-OLD']},
            'issueTypes': self.DEFAULT_ISSUE_TYPES, 'projects': {}})
        self.post_and_assert_actor_cache_eviction({'version': 2,
            'scope': {'rootGoalKey': 'ROOT-NEW', 'subGoalKeys': ['CHILD-NEW']},
            'labelPrefix': 'rnd_project_', 'issueTypes': self.DEFAULT_ISSUE_TYPES, 'projects': {}})

    def test_jira_labels_prefix_filters_case_insensitive_startswith(self):
        labels = [
            'rnd_project_alpha',
            'RND_PROJECT_BETA',
            'team_rnd_project_gamma',
            'rnd_other_delta',
        ]

        with patch.object(jira_server, 'current_jira_get', return_value=self._label_catalog_response(labels)):
            response = self.client.get('/api/jira/labels?prefix=rnd_project_')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['labels'], ['rnd_project_alpha', 'RND_PROJECT_BETA'])

    def _label_catalog_response(self, values):
        class Response:
            status_code = 200

            def json(self):
                return {'values': values, 'isLast': True}
        return Response()

    def _label_suggestions_response(self, values, status_code=200):
        class _Response:
            def __init__(self):
                self.status_code = status_code

            def json(self):
                return {'results': [{'value': value, 'displayName': f'<b>{value}</b>'} for value in values]}

        return _Response()

    def test_jira_labels_query_uses_jql_autocomplete_without_catalog_crawl(self):
        with patch.object(jira_server, 'LABELS_CACHE', {'data': [], 'timestamp': 0}), \
             patch.object(jira_server, 'current_jira_get', return_value=self._label_suggestions_response(
                 ['team_alpha', 'team_alpha_web', '"team_and"'],
             )) as mock_get:
            response = self.client.get('/api/jira/labels?query=Team_A&limit=2')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['labels'], ['team_alpha', 'team_alpha_web'])
        mock_get.assert_called_once()
        path = mock_get.call_args.args[0]
        params = mock_get.call_args.kwargs['params']
        self.assertEqual(path, '/rest/api/3/jql/autocompletedata/suggestions')
        self.assertEqual(params, {'fieldName': 'labels', 'fieldValue': 'team_a'})

    def test_jira_labels_query_strips_jql_quotes_and_applies_prefix(self):
        with patch.object(jira_server, 'current_jira_get', return_value=self._label_suggestions_response(
            ['"rnd_project_and"', 'rnd_project_alpha', 'rnd_other'],
        )):
            response = self.client.get('/api/jira/labels?query=rnd_&prefix=rnd_project_*')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['labels'], ['rnd_project_and', 'rnd_project_alpha'])

    def test_jira_labels_query_reports_autocomplete_failure(self):
        with patch.object(jira_server, 'current_jira_get', return_value=self._label_suggestions_response([], 503)):
            response = self.client.get('/api/jira/labels?query=team')

        self.assertEqual(response.status_code, 503, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'Failed to fetch labels from Jira')

    def test_jira_labels_limit_cap_applies_after_prefix_filtering(self):
        labels = [f'rnd_project_{index:03d}' for index in range(250)]

        with patch.object(jira_server, 'current_jira_get', return_value=self._label_catalog_response(labels)):
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

        with patch.object(jira_server, 'current_jira_get', return_value=self._label_catalog_response(labels)):
            response = self.client.get('/api/jira/labels?prefix=rnd_project_*')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['labels'], ['rnd_project_app', 'rnd_project_web'])


if __name__ == '__main__':
    unittest.main()
