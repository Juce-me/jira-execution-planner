import unittest
from urllib.error import HTTPError
from unittest.mock import Mock, patch

from epm_home import (
    HomeGraphQLClient,
    bucket_epm_state,
    build_home_project_record,
    extract_latest_update,
    fetch_epm_home_projects,
    resolve_goal_by_key,
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
                {'id': 'goal-1', 'key': '  crite-552 ', 'name': 'Retail Media'},
                {'id': 'goal-2', 'key': 'OTHER-1', 'name': 'Other'},
            ]
        )

        result = resolve_goal_by_key(client, 'crite-552', 'ati:cloud:townsquare::site/cloud-123')

        self.assertEqual(result, {'id': 'goal-1', 'key': '  crite-552 ', 'name': 'Retail Media'})

    def test_build_home_project_record_keeps_metadata_without_jira_linkage(self):
        project = build_home_project_record(
            {
                'id': 'tsq-1',
                'name': 'Retail Media Launch',
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
        mock_warning.assert_called_once_with('EPM home fetch skipped: cloudId and subGoalKey are required')

    @patch('epm_home.logger.warning')
    def test_fetch_epm_home_projects_returns_empty_when_scope_is_malformed_truthy_value(self, mock_warning):
        self.assertEqual(fetch_epm_home_projects('bad-scope'), [])
        mock_warning.assert_called_once_with('EPM home fetch skipped: cloudId and subGoalKey are required')

    @patch('epm_home.build_home_graphql_client')
    @patch('epm_home.logger.warning')
    def test_fetch_epm_home_projects_returns_empty_when_scope_values_are_non_string(self, mock_warning, mock_build_client):
        scope = {'cloudId': {'id': 'cloud-123'}, 'subGoalKey': ['CRITE-552']}

        self.assertEqual(fetch_epm_home_projects(scope), [])

        mock_warning.assert_called_once_with('EPM home fetch skipped: cloudId and subGoalKey are required')
        mock_build_client.assert_not_called()

    @patch('epm_home.extract_home_jira_linkage')
    @patch('epm_home.fetch_latest_project_update')
    @patch('epm_home.fetch_projects_for_goal')
    @patch('epm_home.resolve_goal_by_key')
    @patch('epm_home.build_home_graphql_client')
    def test_fetch_epm_home_projects_resolves_sub_goal_scope(
        self,
        mock_build_client,
        mock_resolve_goal,
        mock_fetch_projects,
        mock_fetch_updates,
        mock_extract_linkage,
    ):
        client = Mock()
        mock_build_client.return_value = client
        mock_resolve_goal.return_value = {'id': 'goal-552', 'key': 'CRITE-552'}
        mock_fetch_projects.return_value = [
            {
                'id': 'proj-1',
                'key': 'TSQ-1',
                'name': 'Retail Media Launch',
                'url': 'https://home.atlassian.com/projects/proj-1',
                'stateValue': 'ON_TRACK',
                'stateLabel': 'On track',
            }
        ]
        mock_fetch_updates.return_value = []
        mock_extract_linkage.return_value = {'labels': [], 'epicKeys': []}

        result = fetch_epm_home_projects({'cloudId': 'cloud-123', 'subGoalKey': 'crite-552'})

        mock_resolve_goal.assert_called_once_with(client, 'CRITE-552', 'ati:cloud:townsquare::site/cloud-123')
        mock_fetch_projects.assert_called_once_with(client, 'goal-552')
        self.assertEqual(
            result,
            [
                {
                    'homeProjectId': 'proj-1',
                    'name': 'Retail Media Launch',
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
