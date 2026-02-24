import unittest
from unittest.mock import Mock, patch

try:
    import requests
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # pragma: no cover
    requests = None
    jira_server = None
    _IMPORT_ERROR = exc


class _FakeClock:
    def __init__(self, start=0.0):
        self.value = float(start)
        self.sleeps = []

    def now(self):
        return self.value

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.value += float(seconds)


def _mock_response(status_code, payload=None, text=''):
    resp = Mock()
    resp.status_code = status_code
    resp.text = text
    resp.json.return_value = payload if payload is not None else {}
    return resp


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class TestJiraResilience(unittest.TestCase):
    def test_timeout_then_success_retries(self):
        clock = _FakeClock()
        session = Mock()
        session.get.side_effect = [
            requests.Timeout('boom'),
            _mock_response(200, {'ok': True})
        ]
        breaker = jira_server.JiraCircuitBreaker(failure_threshold=3, open_seconds=30)

        response = jira_server.resilient_jira_get(
            'http://jira.example/search',
            session=session,
            breaker=breaker,
            now_fn=clock.now,
            sleep_fn=clock.sleep,
            rand_fn=lambda: 0.0,
            max_attempts=3,
            base_delay_seconds=0.5,
            max_delay_seconds=0.5,
            max_elapsed_seconds=10,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(session.get.call_count, 2)
        self.assertEqual(clock.sleeps, [0.5])

    def test_retryable_status_then_success(self):
        clock = _FakeClock()
        session = Mock()
        session.get.side_effect = [
            _mock_response(503),
            _mock_response(200, {'ok': True})
        ]
        breaker = jira_server.JiraCircuitBreaker(failure_threshold=3, open_seconds=30)

        response = jira_server.resilient_jira_get(
            'http://jira.example/search',
            session=session,
            breaker=breaker,
            now_fn=clock.now,
            sleep_fn=clock.sleep,
            rand_fn=lambda: 0.0,
            max_attempts=3,
            base_delay_seconds=0.25,
            max_delay_seconds=0.25,
            max_elapsed_seconds=10,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(session.get.call_count, 2)
        self.assertEqual(clock.sleeps, [0.25])

    def test_non_retryable_400_does_not_retry(self):
        clock = _FakeClock()
        session = Mock()
        session.get.return_value = _mock_response(400, text='bad request')
        breaker = jira_server.JiraCircuitBreaker(failure_threshold=2, open_seconds=30)

        response = jira_server.resilient_jira_get(
            'http://jira.example/search',
            session=session,
            breaker=breaker,
            now_fn=clock.now,
            sleep_fn=clock.sleep,
            rand_fn=lambda: 0.0,
            max_attempts=5,
            max_elapsed_seconds=10,
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(session.get.call_count, 1)
        self.assertEqual(clock.sleeps, [])

    def test_circuit_opens_after_failures_and_fast_fails(self):
        clock = _FakeClock()
        session = Mock()
        session.get.side_effect = requests.ConnectionError('offline')
        breaker = jira_server.JiraCircuitBreaker(failure_threshold=1, open_seconds=30)

        first = jira_server.resilient_jira_get(
            'http://jira.example/search',
            session=session,
            breaker=breaker,
            now_fn=clock.now,
            sleep_fn=clock.sleep,
            rand_fn=lambda: 0.0,
            max_attempts=1,
            max_elapsed_seconds=10,
        )
        self.assertEqual(first.status_code, 503)
        self.assertEqual(session.get.call_count, 1)

        second = jira_server.resilient_jira_get(
            'http://jira.example/search',
            session=session,
            breaker=breaker,
            now_fn=clock.now,
            sleep_fn=clock.sleep,
            rand_fn=lambda: 0.0,
            max_attempts=1,
            max_elapsed_seconds=10,
        )
        self.assertEqual(second.status_code, 503)
        self.assertEqual(session.get.call_count, 1, 'circuit-open path should not call session.get')
        payload = second.json()
        self.assertEqual(payload.get('error'), 'Jira temporarily unavailable')
        self.assertEqual((payload.get('circuit') or {}).get('state'), 'open')

    def test_half_open_success_closes_breaker(self):
        clock = _FakeClock(start=0.0)
        session = Mock()
        session.get.return_value = _mock_response(200, {'ok': True})
        breaker = jira_server.JiraCircuitBreaker(failure_threshold=1, open_seconds=5)
        breaker.force_open(now=clock.now())
        clock.value = 6.0

        response = jira_server.resilient_jira_get(
            'http://jira.example/search',
            session=session,
            breaker=breaker,
            now_fn=clock.now,
            sleep_fn=clock.sleep,
            rand_fn=lambda: 0.0,
            max_attempts=1,
            max_elapsed_seconds=10,
        )

        self.assertEqual(response.status_code, 200)
        allowed, state = breaker.before_request(clock.now())
        self.assertTrue(allowed)
        self.assertEqual(state.get('state'), 'closed')

    def test_half_open_failure_reopens_breaker(self):
        clock = _FakeClock(start=0.0)
        session = Mock()
        session.get.side_effect = requests.Timeout('still down')
        breaker = jira_server.JiraCircuitBreaker(failure_threshold=1, open_seconds=5)
        breaker.force_open(now=clock.now())
        clock.value = 6.0

        response = jira_server.resilient_jira_get(
            'http://jira.example/search',
            session=session,
            breaker=breaker,
            now_fn=clock.now,
            sleep_fn=clock.sleep,
            rand_fn=lambda: 0.0,
            max_attempts=1,
            max_elapsed_seconds=10,
        )

        self.assertEqual(response.status_code, 503)
        allowed, state = breaker.before_request(clock.now())
        self.assertFalse(allowed)
        self.assertEqual(state.get('state'), 'open')

    def test_api_test_endpoint_fast_fails_when_circuit_is_open(self):
        breaker = jira_server.JiraCircuitBreaker(failure_threshold=1, open_seconds=30)
        breaker.force_open(now=0.0)

        with patch.object(jira_server, 'JIRA_SEARCH_CIRCUIT_BREAKER', breaker):
            client = jira_server.app.test_client()
            resp = client.get('/api/test')

        self.assertEqual(resp.status_code, 503)
        data = resp.get_json() or {}
        self.assertEqual(data.get('status'), 'error')
        self.assertIn('temporarily unavailable', str(data.get('message', '')).lower())


if __name__ == '__main__':
    unittest.main()
