import threading
import time
import unittest
from unittest.mock import patch

from backend import jira_client
from backend.services import jira_batches
from backend.services.jira_batches import JiraBatchIncomplete


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


def key_payload(keys, token=None):
    payload = {
        'jql': 'key in (' + ','.join(f'"{key}"' for key in keys) + ')',
        'maxResults': 100,
        'fields': ['summary'],
    }
    if token:
        payload['nextPageToken'] = token
    return payload


class FetchIssuesByKeysModesTests(unittest.TestCase):
    def setUp(self):
        patcher = patch.object(jira_batches, '_ADMISSION', jira_batches._ProcessAdmission())
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_non_strict_default_is_unchanged_for_other_callers(self):
        calls = []
        caller = threading.get_ident()
        keys = [f'SYN-{idx}' for idx in range(250)]

        def search_request(payload, context=None):
            calls.append((payload, context, threading.get_ident()))
            if len(calls) == 2:
                return FakeResponse(503, {'error': 'Jira temporarily unavailable', 'upstreamStatus': 429})
            return FakeResponse(200, {
                'issues': [{'key': f'ROW-{len(calls)}'}],
                'nextPageToken': 'ignored-by-non-strict',
                'isLast': False,
            })

        warnings = []
        issues = jira_client.fetch_issues_by_keys(
            keys, ['summary'], search_request=search_request, context='ctx-3', log_warning_fn=warnings.append)

        self.assertEqual(issues, [{'key': 'ROW-1'}, {'key': 'ROW-3'}])
        self.assertEqual([call[0] for call in calls], [
            key_payload(keys[:100]), key_payload(keys[100:200]), key_payload(keys[200:])])
        self.assertTrue(all(call[1] == 'ctx-3' and call[2] == caller for call in calls))
        self.assertEqual(warnings, ['Dependencies fetch error: status=503'])

    def test_strict_follows_continuation_tokens_in_batch_order(self):
        calls = []
        keys = [f'SYN-{idx}' for idx in range(150)]
        pages = {
            (keys[0], None): {'issues': [{'key': 'A-1'}], 'nextPageToken': 'a2', 'isLast': False},
            (keys[0], 'a2'): {'issues': [{'key': 'A-2'}], 'nextPageToken': 'a3', 'isLast': False},
            (keys[0], 'a3'): {'issues': [{'key': 'A-3'}], 'isLast': True},
            (keys[100], None): {'issues': [{'key': 'B-1'}], 'nextPageToken': 'b2', 'isLast': False},
            (keys[100], 'b2'): {'issues': [{'key': 'B-2'}], 'isLast': True},
        }
        lock = threading.Lock()

        def search_request(payload, context=None):
            with lock:
                calls.append(payload)
            first = payload['jql'].split('"')[1]
            return FakeResponse(200, pages[(first, payload.get('nextPageToken'))])

        for cap in (1, 4):
            with self.subTest(cap=cap):
                calls.clear()
                issues = jira_client.fetch_issues_by_keys(
                    keys, ['summary'], search_request=search_request, strict=True, max_concurrency=cap)
                self.assertEqual([issue['key'] for issue in issues], ['A-1', 'A-2', 'A-3', 'B-1', 'B-2'])
                self.assertCountEqual(calls, [
                    key_payload(keys[:100]), key_payload(keys[:100], 'a2'), key_payload(keys[:100], 'a3'),
                    key_payload(keys[100:]), key_payload(keys[100:], 'b2')])

    def test_strict_raises_on_a_non_200_with_the_completed_batches_as_partial(self):
        keys = [f'SYN-{idx}' for idx in range(150)]

        def search_request(payload, context=None):
            if '"SYN-100"' in payload['jql']:
                return FakeResponse(500, {'error': 'upstream'})
            return FakeResponse(200, {'issues': [{'key': 'A-1'}], 'isLast': True})

        for cap in (1, 4):
            with self.subTest(cap=cap), self.assertRaises(JiraBatchIncomplete) as raised:
                jira_client.fetch_issues_by_keys(
                    keys, ['summary'], search_request=search_request, strict=True, max_concurrency=cap)
            self.assertEqual(raised.exception.reason, 'http_status')
            self.assertFalse(raised.exception.rate_limited)
            self.assertEqual(raised.exception.partial, [{'key': 'A-1'}])

    def test_strict_raises_on_a_malformed_page(self):
        malformed = {
            'not a dict': ['A-1'],
            'issues not a list': {'issues': {'key': 'A-1'}, 'isLast': True},
            'row not a dict': {'issues': ['A-1'], 'isLast': True},
            'isLast missing': {'issues': [{'key': 'A-1'}]},
            'not last without a token': {'issues': [{'key': 'A-1'}], 'isLast': False},
        }
        for name, body in malformed.items():
            with self.subTest(name), self.assertRaises(JiraBatchIncomplete) as raised:
                jira_client.fetch_issues_by_keys(
                    ['SYN-1'], ['summary'], strict=True,
                    search_request=lambda payload, context=None, body=body: FakeResponse(200, body))
            self.assertEqual(raised.exception.reason, 'continuation')
            self.assertEqual(raised.exception.partial, [])

        def repeated_token(payload, context=None):
            return FakeResponse(200, {'issues': [{'key': 'A-1'}], 'nextPageToken': 'same', 'isLast': False})

        with self.assertRaises(JiraBatchIncomplete) as raised:
            jira_client.fetch_issues_by_keys(['SYN-1'], ['summary'], strict=True, search_request=repeated_token)
        self.assertEqual(raised.exception.reason, 'continuation')

        def unreadable(payload, context=None):
            response = FakeResponse(200, None)
            response.json = lambda: (_ for _ in ()).throw(ValueError('not json'))
            return response

        with self.assertRaises(JiraBatchIncomplete) as raised:
            jira_client.fetch_issues_by_keys(['SYN-1'], ['summary'], strict=True, search_request=unreadable)
        self.assertEqual(raised.exception.reason, 'continuation')

    def test_strict_raises_after_more_than_ten_pages(self):
        calls = []

        def endless(payload, context=None):
            calls.append(payload)
            return FakeResponse(200, {
                'issues': [{'key': f'A-{len(calls)}'}], 'nextPageToken': f'page-{len(calls) + 1}', 'isLast': False})

        with self.assertRaises(JiraBatchIncomplete) as raised:
            jira_client.fetch_issues_by_keys(['SYN-1'], ['summary'], strict=True, search_request=endless)
        self.assertEqual(jira_client.MAX_PAGES_PER_BATCH, 10)
        self.assertEqual(raised.exception.reason, 'continuation')
        self.assertEqual(len(calls), 10)
        self.assertEqual(raised.exception.partial, [])

    def test_strict_classifies_a_synthetic_503_with_upstream_429_as_rate_limited(self):
        responses = {
            'synthetic 503': jira_client._build_jira_unavailable_response(
                'Jira rate limited the request', attempts=4, elapsed_seconds=1, upstream_status=429),
            'direct 429': FakeResponse(429, {'errorMessages': ['Rate limited']}),
        }
        for name, response in responses.items():
            with self.subTest(name), self.assertRaises(JiraBatchIncomplete) as raised:
                jira_client.fetch_issues_by_keys(
                    ['SYN-1'], ['summary'], strict=True,
                    search_request=lambda payload, context=None, response=response: response)
            self.assertEqual(raised.exception.reason, 'rate_limited')
            self.assertTrue(raised.exception.rate_limited)

        plain_503 = jira_client._build_jira_unavailable_response('Jira is down', upstream_status=503)
        with self.assertRaises(JiraBatchIncomplete) as raised:
            jira_client.fetch_issues_by_keys(
                ['SYN-1'], ['summary'], strict=True, search_request=lambda payload, context=None: plain_503)
        self.assertEqual(raised.exception.reason, 'http_status')
        self.assertFalse(raised.exception.rate_limited)

    def test_a_deadline_bounds_each_call_timeout_and_stops_admission(self):
        timeouts = []

        def search_request(payload, context=None, timeout=None):
            timeouts.append(timeout)
            return FakeResponse(200, {'issues': [], 'isLast': True})

        jira_client.fetch_issues_by_keys(
            ['SYN-1'], ['summary'], strict=True, search_request=search_request,
            deadline=time.monotonic() + 100)
        jira_client.fetch_issues_by_keys(
            ['SYN-1'], ['summary'], strict=True, search_request=search_request,
            deadline=time.monotonic() + 5)
        self.assertEqual(timeouts[0], 30.0)
        self.assertGreater(timeouts[1], 4.0)
        self.assertLessEqual(timeouts[1], 5.0)

        with self.assertRaises(JiraBatchIncomplete) as raised:
            jira_client.fetch_issues_by_keys(
                ['SYN-1'], ['summary'], strict=True, search_request=search_request,
                deadline=time.monotonic() - 1)
        self.assertEqual(raised.exception.reason, 'deadline')
        self.assertEqual(len(timeouts), 2)


if __name__ == '__main__':
    unittest.main()
