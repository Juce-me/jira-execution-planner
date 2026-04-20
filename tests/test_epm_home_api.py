import unittest
from urllib.error import HTTPError
from unittest.mock import Mock, patch

from epm_home import HomeGraphQLClient, bucket_epm_state, build_home_project_record, extract_latest_update


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
