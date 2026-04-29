import unittest
import threading
import time
from urllib.error import HTTPError
from unittest.mock import Mock, patch

import epm_home
import jira_server

from epm_home import (
    HomeGraphQLClient,
    bucket_epm_state,
    build_home_project_record,
    extract_latest_update,
    extract_tag_names,
    fetch_epm_home_projects,
    fetch_home_site_cloud_id,
    fetch_latest_project_update,
    fetch_project_tags,
    fetch_projects_for_goal,
    fetch_sub_goals_for_root_key,
    resolve_goal_by_key,
    _container_id_from_cloud,
)


class TestEpmHomeApi(unittest.TestCase):
    def setUp(self):
        cache = getattr(epm_home, '_CLOUD_ID_CACHE', None)
        if cache is not None:
            cache.clear()

    def test_bucket_pending_as_backlog(self):
        self.assertEqual(bucket_epm_state('PENDING'), 'backlog')

    def test_bucket_completed_as_archived(self):
        self.assertEqual(bucket_epm_state('COMPLETED'), 'archived')

    def test_extract_latest_update_prefers_newest_creation_date(self):
        latest = extract_latest_update([
            {'creationDate': '2026-04-01T08:00:00.000Z', 'summary': 'Older update'},
            {'creationDate': '2026-04-09T12:00:00.000Z', 'summary': 'Latest update'},
        ])
        self.assertEqual(latest['date'], '2026-04-09')
        self.assertEqual(latest['snippet'], 'Latest update')

    def test_resolve_goal_by_key_matches_goal_key_case_insensitively(self):
        client = HomeGraphQLClient('user@example.com', 'token')
        client.execute_paginated = Mock(
            return_value=[
                {'id': 'goal-1', 'key': '  child-200 ', 'name': 'Synthetic Child Goal'},
                {'id': 'goal-2', 'key': 'OTHER-1', 'name': 'Other'},
            ]
        )

        result = resolve_goal_by_key(client, 'child-200', 'ati:cloud:townsquare::site/cloud-123')

        self.assertEqual(result, {'id': 'goal-1', 'key': '  child-200 ', 'name': 'Synthetic Child Goal'})

    def test_container_id_uses_ari_prefix(self):
        self.assertEqual(
            _container_id_from_cloud('cloud-123'),
            'ari:cloud:townsquare::site/cloud-123',
        )

    def test_build_home_project_record_keeps_metadata_without_jira_linkage(self):
        project = build_home_project_record(
            {
                'id': 'tsq-1',
                'name': 'Synthetic Launch',
                'url': 'https://home.atlassian.com/projects/tsq-1',
                'stateValue': 'PAUSED',
                'stateLabel': 'Paused',
            },
            [{'creationDate': '2026-04-12T10:00:00.000Z', 'summary': 'Awaiting budget approval'}],
            {},
        )
        self.assertEqual(project['tabBucket'], 'backlog')
        self.assertEqual(project['matchState'], 'metadata-only')
        self.assertEqual(project['latestUpdateDate'], '2026-04-12')
        self.assertEqual(project['latestUpdateSnippet'], 'Awaiting budget approval')

    def test_build_home_project_record_keeps_string_home_tags_from_fetcher(self):
        project = build_home_project_record(
            {
                'id': 'CRITE-723',
                'name': 'Enriched Deals Redesign',
                'url': 'https://home.atlassian.com/project/CRITE-723',
                'stateValue': 'PENDING',
                'stateLabel': 'Pending',
            },
            [],
            {},
            home_tags=['rnd_project_bsw_enriched_deals_redesign'],
        )

        self.assertEqual(project['homeTags'], ['rnd_project_bsw_enriched_deals_redesign'])

    def test_extract_tag_names_normalizes_direct_and_cypher_tag_shapes(self):
        tags = extract_tag_names([
            {'name': ' rnd_project_alpha '},
            {'node': {'name': 'rnd_project_beta'}},
            {'data': {'name': 'rnd_project_gamma'}},
            {'data': {'__typename': 'AtlassianHomeTag', 'name': 'rnd_project_delta'}},
            {'name': 'rnd_project_alpha'},
            {'name': ''},
            'ignored',
        ])

        self.assertEqual(tags, [
            'rnd_project_alpha',
            'rnd_project_beta',
            'rnd_project_gamma',
            'rnd_project_delta',
        ])

    def test_fetch_project_tags_reads_direct_home_project_tags(self):
        client = Mock()
        client.execute.return_value = {
            'data': {
                'projects_byId': {
                    'tags': {
                        'edges': [
                            {'node': {'name': 'rnd_project_alpha'}},
                            {'node': {'name': 'epm'}},
                        ],
                    },
                },
            },
        }

        result = fetch_project_tags(client, {'id': 'proj-1'})

        self.assertEqual(result, ['rnd_project_alpha', 'epm'])
        client.execute.assert_called_once_with(epm_home.QUERY_PROJECT_TAGS, {'projectId': 'proj-1'})

    @patch('epm_home.fetch_home_site_cloud_id', return_value='cloud-123')
    @patch('epm_home.build_teamwork_graph_client')
    def test_fetch_project_tags_falls_back_to_teamwork_graph_when_direct_tags_are_empty(self, mock_build_twg_client, mock_cloud_id):
        home_client = Mock()
        home_client.execute.return_value = {
            'data': {
                'projects_byId': {
                    'tags': {
                        'edges': [],
                    },
                },
            },
        }
        twg_client = Mock()
        twg_client.execute.return_value = {
            'data': {
                'cypherQuery': {
                    'edges': [
                        {
                            'node': {
                                'columns': [
                                    {
                                        'value': {
                                            'nodes': [
                                                {'data': {'__typename': 'AtlassianHomeTag', 'name': 'rnd_project_pubcid_lastimp'}},
                                            ],
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                },
            },
        }
        mock_build_twg_client.return_value = twg_client

        result = fetch_project_tags(home_client, {'id': 'proj-1', 'url': 'https://home/project/proj-1'})

        self.assertEqual(result, ['rnd_project_pubcid_lastimp'])
        mock_cloud_id.assert_called_once_with()
        mock_build_twg_client.assert_called_once_with()

    @patch('epm_home.fetch_home_site_cloud_id', return_value='cloud-123')
    @patch('epm_home.build_teamwork_graph_client')
    def test_fetch_project_tags_falls_back_to_teamwork_graph_relationship(self, mock_build_twg_client, mock_cloud_id):
        home_client = Mock()
        home_client.execute.side_effect = epm_home.HomeGraphQLError('unknown field tags')
        twg_client = Mock()
        twg_client.execute.return_value = {
            'data': {
                'cypherQuery': {
                    'edges': [
                        {
                            'node': {
                                'columns': [
                                    {
                                        'value': {
                                            'nodes': [
                                                {'data': {'__typename': 'AtlassianHomeTag', 'name': 'rnd_project_alpha'}},
                                            ],
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                },
            },
        }
        mock_build_twg_client.return_value = twg_client

        result = fetch_project_tags(home_client, {'id': 'proj-1', 'url': 'https://home/project/proj-1'})

        self.assertEqual(result, ['rnd_project_alpha'])
        mock_cloud_id.assert_called_once_with()
        mock_build_twg_client.assert_called_once_with()
        self.assertIn('atlassian_project_has_atlassian_home_tag', twg_client.execute.call_args.args[1]['cypherQuery'])

    def test_fetch_epm_home_projects_requires_scope_argument(self):
        with self.assertRaises(TypeError):
            fetch_epm_home_projects()

    @patch('epm_home.logger.warning')
    def test_fetch_epm_home_projects_returns_empty_when_scope_missing(self, mock_warning):
        self.assertEqual(fetch_epm_home_projects({}), [])
        mock_warning.assert_called_once_with('EPM home fetch skipped: subGoalKey is required')

    @patch('epm_home.logger.warning')
    def test_fetch_epm_home_projects_returns_empty_when_scope_is_malformed_truthy_value(self, mock_warning):
        self.assertEqual(fetch_epm_home_projects('bad-scope'), [])
        mock_warning.assert_called_once_with('EPM home fetch skipped: subGoalKey is required')

    @patch('epm_home.build_home_graphql_client')
    @patch('epm_home.logger.warning')
    def test_fetch_epm_home_projects_returns_empty_when_scope_values_are_non_string(self, mock_warning, mock_build_client):
        scope = {'subGoalKey': ['CHILD-200']}

        self.assertEqual(fetch_epm_home_projects(scope), [])

        mock_warning.assert_called_once_with('EPM home fetch skipped: subGoalKey is required')
        mock_build_client.assert_not_called()

    @patch.dict('os.environ', {'JIRA_URL': ''}, clear=False)
    @patch.object(jira_server, 'JIRA_URL', 'https://example.atlassian.net')
    @patch('epm_home.urlopen')
    def test_fetch_home_site_cloud_id_uses_jira_tenant_info(self, mock_urlopen):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'{"cloudId":"cloud-123"}'
        mock_urlopen.return_value = response

        self.assertEqual(fetch_home_site_cloud_id(), 'cloud-123')
        self.assertEqual(mock_urlopen.call_args[0][0].full_url, 'https://example.atlassian.net/_edge/tenant_info')

    @patch.dict('os.environ', {'JIRA_URL': ''}, clear=False)
    @patch.object(jira_server, 'JIRA_URL', 'https://cached.atlassian.net')
    @patch('epm_home.urlopen')
    def test_fetch_home_site_cloud_id_is_cached_per_jira_url(self, mock_urlopen):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'{"cloudId":"cloud-cached"}'
        mock_urlopen.return_value = response

        self.assertEqual(fetch_home_site_cloud_id(), 'cloud-cached')
        self.assertEqual(fetch_home_site_cloud_id(), 'cloud-cached')

        self.assertEqual(mock_urlopen.call_count, 1)

    @patch.dict('os.environ', {'JIRA_URL': ''}, clear=False)
    @patch.object(jira_server, 'JIRA_URL', 'https://cli-override.atlassian.net')
    @patch('epm_home.urlopen')
    def test_fetch_home_site_cloud_id_prefers_jira_server_cli_override(self, mock_urlopen):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'{"cloudId":"cloud-456"}'
        mock_urlopen.return_value = response

        self.assertEqual(fetch_home_site_cloud_id(), 'cloud-456')
        self.assertEqual(mock_urlopen.call_args[0][0].full_url, 'https://cli-override.atlassian.net/_edge/tenant_info')

    @patch('epm_home.resolve_goal_by_key')
    def test_fetch_sub_goals_for_root_key_returns_non_archived_children(self, mock_resolve_goal):
        client = HomeGraphQLClient('user@example.com', 'token')
        client.execute_paginated = Mock(
            return_value=[
                {'id': 'goal-child', 'key': 'CHILD-200', 'name': 'Synthetic Child Goal', 'url': 'https://home/goal/child-200', 'isArchived': False},
                {'id': 'goal-old', 'key': 'ARCHIVE-999', 'name': 'Old', 'url': 'https://home/goal/archive-999', 'isArchived': True},
            ]
        )
        mock_resolve_goal.return_value = {'id': 'goal-root', 'key': 'ROOT-100'}

        result = fetch_sub_goals_for_root_key(client, 'ROOT-100', 'ari:cloud:townsquare::site/cloud-123')

        self.assertEqual(result, [{'id': 'goal-child', 'key': 'CHILD-200', 'name': 'Synthetic Child Goal', 'url': 'https://home/goal/child-200', 'isArchived': False}])

    @patch('epm_home.extract_home_jira_linkage')
    @patch('epm_home.fetch_latest_project_update')
    @patch('epm_home.fetch_projects_for_goal')
    @patch('epm_home.fetch_home_site_cloud_id')
    @patch('epm_home.build_home_graphql_client')
    def test_fetch_epm_home_projects_resolves_child_sub_goal_from_root_children(
        self,
        mock_build_client,
        mock_fetch_cloud_id,
        mock_fetch_projects,
        mock_fetch_updates,
        mock_extract_linkage,
    ):
        client = Mock()

        def execute_paginated(_query, variables, path):
            if path == 'goals_search':
                return [{'id': 'goal-root', 'key': 'ROOT-100', 'name': 'Synthetic Root Goal'}]
            if path == 'goals_byId.subGoals':
                self.assertEqual(variables['goalId'], 'goal-root')
                return [
                    {'id': 'goal-child', 'key': ' CHILD-200 ', 'name': 'Synthetic Child Goal', 'url': 'https://home/goal/child-200', 'isArchived': False},
                ]
            raise AssertionError(f'unexpected path: {path}')

        client.execute_paginated = Mock(side_effect=execute_paginated)
        mock_build_client.return_value = client
        mock_fetch_cloud_id.return_value = 'cloud-123'
        mock_fetch_projects.return_value = [
            {
                'homeProjectId': 'proj-1',
                'name': 'Synthetic Launch',
                'homeUrl': 'https://home.atlassian.com/projects/proj-1',
                'stateValue': 'ON_TRACK',
                'stateLabel': 'On track',
                'tabBucket': 'active',
                'latestUpdateDate': '',
                'latestUpdateSnippet': '',
                'resolvedLinkage': {'labels': [], 'epicKeys': []},
                'matchState': 'metadata-only',
            }
        ]
        mock_fetch_updates.return_value = []
        mock_extract_linkage.return_value = {'labels': [], 'epicKeys': []}

        result = fetch_epm_home_projects({'rootGoalKey': 'root-100', 'subGoalKey': 'child-200'})

        mock_fetch_projects.assert_called_once_with(client, 'goal-child')
        self.assertEqual(result[0]['name'], 'Synthetic Launch')

    @patch('epm_home.extract_home_jira_linkage')
    @patch('epm_home.fetch_latest_project_update')
    @patch('epm_home.fetch_projects_for_goal')
    @patch('epm_home.resolve_goal_by_key')
    @patch('epm_home.fetch_home_site_cloud_id')
    @patch('epm_home.build_home_graphql_client')
    def test_fetch_epm_home_projects_resolves_sub_goal_scope(
        self,
        mock_build_client,
        mock_fetch_cloud_id,
        mock_resolve_goal,
        mock_fetch_projects,
        mock_fetch_updates,
        mock_extract_linkage,
    ):
        client = Mock()
        mock_build_client.return_value = client
        mock_fetch_cloud_id.return_value = 'cloud-123'
        mock_resolve_goal.return_value = {'id': 'goal-child', 'key': 'CHILD-200'}
        mock_fetch_projects.return_value = [
            {
                'homeProjectId': 'proj-1',
                'name': 'Synthetic Launch',
                'homeUrl': 'https://home.atlassian.com/projects/proj-1',
                'stateValue': 'ON_TRACK',
                'stateLabel': 'On track',
                'tabBucket': 'active',
                'latestUpdateDate': '',
                'latestUpdateSnippet': '',
                'resolvedLinkage': {'labels': [], 'epicKeys': []},
                'matchState': 'metadata-only',
            }
        ]
        mock_fetch_updates.return_value = []
        mock_extract_linkage.return_value = {'labels': [], 'epicKeys': []}

        result = fetch_epm_home_projects({'subGoalKey': 'child-200'})

        mock_resolve_goal.assert_called_once_with(client, 'CHILD-200', 'ari:cloud:townsquare::site/cloud-123')
        mock_fetch_projects.assert_called_once_with(client, 'goal-child')
        self.assertEqual(
            result,
            [
                {
                    'homeProjectId': 'proj-1',
                    'name': 'Synthetic Launch',
                    'homeUrl': 'https://home.atlassian.com/projects/proj-1',
                    'stateValue': 'ON_TRACK',
                    'stateLabel': 'On track',
                    'tabBucket': 'active',
                    'latestUpdateDate': '',
                    'latestUpdateSnippet': '',
                    'resolvedLinkage': {'labels': [], 'epicKeys': []},
                    'matchState': 'metadata-only',
                }
            ],
        )

    def test_fetch_latest_project_update_requests_one_update_page_with_first_one(self):
        client = Mock()
        client.execute.return_value = {
            'data': {
                'projects_byId': {
                    'updates': {
                        'pageInfo': {'hasNextPage': True, 'endCursor': 'cursor-1'},
                        'edges': [
                            {
                                'node': {
                                    'id': 'update-1',
                                    'creationDate': '2026-04-12T10:00:00.000Z',
                                    'summary': 'Latest status',
                                }
                            }
                        ],
                    }
                }
            }
        }

        result = fetch_latest_project_update(client, 'proj-1')

        client.execute.assert_called_once_with(
            epm_home.QUERY_PROJECT_UPDATES,
            {'projectId': 'proj-1', 'first': 1},
        )
        self.assertEqual(result, [{'id': 'update-1', 'creationDate': '2026-04-12T10:00:00.000Z', 'summary': 'Latest status'}])

    @patch('epm_home.fetch_latest_project_update')
    @patch('epm_home.fetch_goal_project_links')
    def test_fetch_projects_for_goal_preserves_link_order_after_parallel_enrichment(self, mock_project_links, mock_fetch_update):
        client = Mock()
        mock_project_links.return_value = [
            {'id': 'proj-slow'},
            {'id': 'proj-fast'},
            {'id': 'proj-medium'},
        ]

        def execute(_query, variables):
            project_id = variables['projectId']
            if project_id == 'proj-slow':
                time.sleep(0.05)
            return {
                'data': {
                    'projects_byId': {
                        'id': project_id,
                        'key': project_id.upper(),
                        'name': f'Project {project_id}',
                        'url': f'https://home/{project_id}',
                        'state': {'label': 'On track', 'value': 'ON_TRACK'},
                    }
                }
            }

        client.execute.side_effect = execute
        mock_fetch_update.return_value = []

        with patch('epm_home.fetch_project_tags', return_value=[]):
            result = fetch_projects_for_goal(client, 'goal-1')

        self.assertEqual([row['homeProjectId'] for row in result], ['proj-slow', 'proj-fast', 'proj-medium'])

    @patch('epm_home.fetch_goal_project_links')
    @patch('epm_home.resolve_sub_goal_for_scope')
    @patch('epm_home.fetch_home_site_cloud_id')
    @patch('epm_home.build_home_graphql_client')
    def test_latest_update_fetches_share_bounded_fanout_and_home_projects_consumes_enriched_rows(
        self,
        mock_build_client,
        mock_fetch_cloud_id,
        mock_resolve_goal,
        mock_project_links,
    ):
        client = Mock()
        mock_build_client.return_value = client
        mock_fetch_cloud_id.return_value = 'cloud-123'
        mock_resolve_goal.return_value = {'id': 'goal-1', 'key': 'CHILD-200'}
        mock_project_links.return_value = [{'id': 'proj-a'}, {'id': 'proj-b'}]

        def execute(_query, variables):
            project_id = variables['projectId']
            return {
                'data': {
                    'projects_byId': {
                        'id': project_id,
                        'key': project_id.upper(),
                        'name': f'Project {project_id}',
                        'url': f'https://home/{project_id}',
                        'state': {'label': 'On track', 'value': 'ON_TRACK'},
                    }
                }
            }

        client.execute.side_effect = execute
        first_update_started = threading.Event()
        release_updates = threading.Event()
        update_calls = []
        update_lock = threading.Lock()

        def fetch_update(_client, project_id):
            with update_lock:
                update_calls.append(project_id)
                if len(update_calls) == 1:
                    first_update_started.set()
            if project_id == 'proj-a':
                self.assertTrue(release_updates.wait(1), 'second update fetch did not overlap the first')
            else:
                self.assertTrue(first_update_started.wait(1), 'first update fetch never started')
                release_updates.set()
            return [{'creationDate': '2026-04-12T10:00:00.000Z', 'summary': f'Update {project_id}'}]

        with patch('epm_home.fetch_latest_project_update', side_effect=fetch_update) as mock_fetch_update, patch(
            'epm_home.fetch_project_tags',
            return_value=[],
        ):
            result = fetch_epm_home_projects({'subGoalKey': 'child-200'})

        self.assertEqual(mock_fetch_update.call_count, 2)
        self.assertCountEqual(update_calls, ['proj-a', 'proj-b'])
        self.assertEqual([row['homeProjectId'] for row in result], ['proj-a', 'proj-b'])
        self.assertEqual([row['latestUpdateSnippet'] for row in result], ['Update proj-a', 'Update proj-b'])

        with patch('epm_home.fetch_projects_for_goal') as mock_fetch_projects, patch(
            'epm_home.fetch_latest_project_update',
            side_effect=AssertionError('fetch_epm_home_projects must not fetch updates sequentially'),
        ) as mock_late_update:
            mock_fetch_projects.return_value = [
                {
                    'homeProjectId': 'proj-enriched',
                    'name': 'Already Enriched',
                    'homeUrl': 'https://home/proj-enriched',
                    'stateValue': 'ON_TRACK',
                    'stateLabel': 'On track',
                    'tabBucket': 'active',
                    'latestUpdateDate': '2026-04-12',
                    'latestUpdateSnippet': 'Already fetched',
                    'resolvedLinkage': {'labels': [], 'epicKeys': []},
                    'matchState': 'metadata-only',
                }
            ]

            result = fetch_epm_home_projects({'subGoalKey': 'child-200'})

        mock_fetch_projects.assert_called_once_with(client, 'goal-1')
        mock_late_update.assert_not_called()
        self.assertEqual(result[0]['homeProjectId'], 'proj-enriched')

    @patch('epm_home.logger.warning')
    def test_fetch_goal_project_links_caps_at_200_without_fetching_extra_page(self, mock_warning):
        client = Mock()

        def page(cursor, start):
            return {
                'data': {
                    'goals_byId': {
                        'projects': {
                            'pageInfo': {'hasNextPage': True, 'endCursor': cursor},
                            'edges': [{'node': {'id': f'proj-{index}'}} for index in range(start, start + 50)],
                        }
                    }
                }
            }

        client.execute.side_effect = [
            page('cursor-1', 0),
            page('cursor-2', 50),
            page('cursor-3', 100),
            page('cursor-4', 150),
            page('cursor-5', 200),
        ]

        result = epm_home.fetch_goal_project_links(client, 'goal-1')

        self.assertEqual(len(result), 200)
        self.assertEqual(result[0]['id'], 'proj-0')
        self.assertEqual(result[-1]['id'], 'proj-199')
        self.assertEqual(client.execute.call_count, 4)
        for call_index, call in enumerate(client.execute.call_args_list):
            variables = call.args[1]
            self.assertEqual(variables['first'], 50)
            self.assertEqual(variables['goalId'], 'goal-1')
            if call_index == 0:
                self.assertIsNone(variables['after'])
            else:
                self.assertEqual(variables['after'], f'cursor-{call_index}')
        mock_warning.assert_called_once()
        self.assertIn('truncated', mock_warning.call_args.args[0])

    @patch('epm_home.fetch_home_site_cloud_id', side_effect=RuntimeError('Jira tenant_info did not return cloudId'))
    @patch('epm_home.logger.warning')
    def test_fetch_epm_home_projects_returns_empty_when_tenant_info_lookup_fails(self, mock_warning, mock_fetch_cloud_id):
        self.assertEqual(fetch_epm_home_projects({'subGoalKey': 'child-200'}), [])
        mock_fetch_cloud_id.assert_called_once_with()
        mock_warning.assert_called_once()
        self.assertEqual(mock_warning.call_args[0][0], 'EPM home fetch failed: %s')
        self.assertIsInstance(mock_warning.call_args[0][1], RuntimeError)
        self.assertEqual(str(mock_warning.call_args[0][1]), 'Jira tenant_info did not return cloudId')

    @patch('epm_home.time.sleep')
    @patch('epm_home.urlopen')
    def test_execute_retries_429_after_retry_after_before_success(self, mock_urlopen, mock_sleep):
        transient_error = HTTPError(
            'https://team.atlassian.com/gateway/api/graphql',
            429,
            'Too Many Requests',
            {'Retry-After': '3'},
            None,
        )
        successful_response = Mock()
        successful_response.__enter__ = Mock(return_value=successful_response)
        successful_response.__exit__ = Mock(return_value=False)
        successful_response.read.return_value = b'{"data":{"ok":true}}'
        mock_urlopen.side_effect = [transient_error, successful_response]

        client = HomeGraphQLClient('user@example.com', 'token')
        result = client.execute('query Test { ok }')

        self.assertEqual(result['data']['ok'], True)
        self.assertEqual(mock_urlopen.call_count, 2)
        mock_sleep.assert_called_once_with(3)

    def test_execute_paginated_stops_when_cursor_missing(self):
        client = HomeGraphQLClient('user@example.com', 'token')
        client.execute = Mock(
            side_effect=[
                {
                    'data': {
                        'goals_search': {
                            'pageInfo': {'hasNextPage': True},
                            'edges': [{'node': {'id': 'goal-1'}}],
                        }
                    }
                },
                AssertionError('pagination should stop when endCursor is missing'),
            ]
        )

        result = client.execute_paginated('query Test', {'first': 1}, 'goals_search')

        self.assertEqual(result, [{'id': 'goal-1'}])
        self.assertEqual(client.execute.call_count, 1)
