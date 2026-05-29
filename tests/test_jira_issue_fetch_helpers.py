import unittest

from backend import jira_client


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class TestJiraIssueFetchHelpers(unittest.TestCase):
    def test_fetch_issues_by_jql_uses_next_page_token_until_last_page(self):
        calls = []
        responses = [
            FakeResponse(200, {
                'issues': [{'key': 'SYN-1'}],
                'nextPageToken': 'page-2',
                'isLast': False,
            }),
            FakeResponse(200, {
                'issues': [{'key': 'SYN-2'}],
                'isLast': True,
            }),
        ]

        def search_request(payload, context=None):
            calls.append((payload, context))
            return responses.pop(0)

        issues = jira_client.fetch_issues_by_jql(
            'project = SYN',
            ['summary'],
            max_results=500,
            search_request=search_request,
            context='ctx-1',
        )

        self.assertEqual(issues, [{'key': 'SYN-1'}, {'key': 'SYN-2'}])
        self.assertEqual(calls, [
            ({
                'jql': 'project = SYN',
                'maxResults': 100,
                'fields': ['summary'],
            }, 'ctx-1'),
            ({
                'jql': 'project = SYN',
                'maxResults': 100,
                'fields': ['summary'],
                'nextPageToken': 'page-2',
            }, 'ctx-1'),
        ])

    def test_fetch_issues_by_jql_caps_page_size_to_remaining_results(self):
        calls = []

        def search_request(payload, context=None):
            calls.append(payload)
            return FakeResponse(200, {
                'issues': [{'key': f'SYN-{idx}'} for idx in range(payload['maxResults'])],
                'nextPageToken': 'next',
                'isLast': False,
            })

        issues = jira_client.fetch_issues_by_jql(
            'project = SYN',
            ['summary'],
            max_results=125,
            search_request=search_request,
        )

        self.assertEqual(len(issues), 125)
        self.assertEqual([call['maxResults'] for call in calls], [100, 25])

    def test_fetch_issues_by_jql_logs_and_stops_on_non_200(self):
        warnings = []

        def search_request(_payload, context=None):
            return FakeResponse(500, {'error': 'upstream'})

        issues = jira_client.fetch_issues_by_jql(
            'project = SYN',
            ['summary'],
            search_request=search_request,
            log_warning_fn=warnings.append,
        )

        self.assertEqual(issues, [])
        self.assertEqual(warnings, ['Scenario fetch error: status=500'])

    def test_fetch_issues_by_keys_batches_keys_and_continues_after_failed_batch(self):
        calls = []

        def search_request(payload, context=None):
            calls.append((payload, context))
            if len(calls) == 1:
                return FakeResponse(500, {'error': 'upstream'})
            return FakeResponse(200, {'issues': [{'key': 'SYN-101'}]})

        issues = jira_client.fetch_issues_by_keys(
            [f'SYN-{idx}' for idx in range(101)],
            ['summary'],
            search_request=search_request,
            context='ctx-2',
        )

        self.assertEqual(issues, [{'key': 'SYN-101'}])
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][0]['maxResults'], 100)
        self.assertIn('"SYN-0"', calls[0][0]['jql'])
        self.assertIn('"SYN-99"', calls[0][0]['jql'])
        self.assertEqual(calls[1], ({
            'jql': 'key in ("SYN-100")',
            'maxResults': 100,
            'fields': ['summary'],
        }, 'ctx-2'))


if __name__ == '__main__':
    unittest.main()
