import unittest
from urllib.error import HTTPError
from unittest.mock import Mock, patch

import jira_server

from epm_home import (
    HomeGraphQLClient,
    bucket_epm_state,
    build_home_project_record,
    extract_latest_update,
    fetch_epm_home_projects,
    fetch_home_site_cloud_id,
    fetch_sub_goals_for_root_key,
    resolve_goal_by_key,
    _container_id_from_cloud,
)


class TestEpmHomeApi(unittest.TestCase):
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
                'id': 'proj-1',
                'key': 'TSQ-1',
                'name': 'Synthetic Launch',
                'url': 'https://home.atlassian.com/projects/proj-1',
                'stateValue': 'ON_TRACK',
                'stateLabel': 'On track',
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
                'id': 'proj-1',
                'key': 'TSQ-1',
                'name': 'Synthetic Launch',
                'url': 'https://home.atlassian.com/projects/proj-1',
                'stateValue': 'ON_TRACK',
                'stateLabel': 'On track',
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
