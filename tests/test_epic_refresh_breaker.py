import unittest
from contextlib import ExitStack
from unittest.mock import Mock, patch

from tests.auth_mode_test_utils import force_basic_auth_mode

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # pragma: no cover
    jira_server = None
    _IMPORT_ERROR = exc


def _http_429():
    response = Mock()
    response.status_code = 429
    response.headers = {}
    response.text = '{}'
    return response


def _fake_jira_get(*_args, http_get=None, params=None, timeout=30, **_kwargs):
    """Stand in for the OAuth/basic wrapper so the real request_get and resilient_jira_get run."""
    return http_get('http://jira.example/rest/api/3/search/jql', params=params, headers={}, timeout=timeout)


def _failures(breaker):
    return breaker.before_request(0.0)[1]['failureCount']


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class EpicRefreshBreakerIsolationTests(unittest.TestCase):
    def setUp(self):
        from backend.routes import eng_routes
        from backend.services import epic_refresh
        force_basic_auth_mode(self, jira_server)
        jira_server.app.testing = True
        self.client = jira_server.app.test_client()
        jira_server.TASKS_CACHE.clear()
        self.epic_refresh = epic_refresh
        eng_routes._EPIC_REFRESH_LIMITER = epic_refresh.EpicRefreshLimiter(min_interval_seconds=0)
        self.global_breaker = jira_server.JiraCircuitBreaker(failure_threshold=5, open_seconds=30)
        self.epic_breaker = jira_server.JiraCircuitBreaker(failure_threshold=5, open_seconds=30)
        self.session = Mock(get=Mock(side_effect=lambda *a, **k: _http_429()))
        stack = ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.object(jira_server, 'JIRA_SEARCH_CIRCUIT_BREAKER', self.global_breaker))
        stack.enter_context(patch.object(epic_refresh, 'EPIC_REFRESH_CIRCUIT_BREAKER', self.epic_breaker))
        stack.enter_context(patch.object(jira_server, 'HTTP_SESSION', self.session))
        stack.enter_context(patch.object(jira_server, 'jira_get', _fake_jira_get))
        stack.enter_context(patch('time.sleep'))

    def _route(self, query):
        with ExitStack() as stack:
            for target, value in (
                ('build_base_jql', 'project = TEST'), ('get_selected_projects_typed', []),
                ('get_configured_issue_types', ['Story']), ('resolve_team_field_id', 'customfield_team'),
                ('resolve_epic_link_field_id', 'customfield_epic_link'), ('get_sprint_field_id', 'customfield_sprint'),
                ('get_project_track_field_id', 'customfield_track'), ('get_delivery_owner_field_id', ''),
            ):
                stack.enter_context(patch.object(jira_server, target, return_value=value))
            return self.client.get('/api/tasks-with-team-name?' + query)

    def test_repeated_epic_refresh_429s_leave_the_global_breaker_untouched(self):
        for _ in range(3):
            response = self._route('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1')
            self.assertEqual(response.status_code, 503)
        self.assertEqual(_failures(self.global_breaker), 0)
        self.assertEqual(self.global_breaker.before_request(0.0)[1]['state'], 'closed')
        self.assertEqual(_failures(self.epic_breaker), 3)

    def test_epic_details_lookup_is_bound_too(self):
        ok = Mock(status_code=200, headers={}, text='{}')
        ok.json.return_value = {'issues': [], 'isLast': True}
        self.session.get.side_effect = [ok] + [_http_429() for _ in range(4)]
        response = self._route('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.session.get.call_count, 3)
        self.assertEqual(_failures(self.global_breaker), 0)
        self.assertEqual(_failures(self.epic_breaker), 1)

    def test_epic_refresh_search_uses_the_small_attempt_budget(self):
        self._route('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1')
        self.assertEqual(self.epic_refresh.EPIC_REFRESH_MAX_ATTEMPTS, 2)
        self.assertEqual(self.session.get.call_count, 2)

    def test_dashboard_search_still_uses_the_global_breaker_and_default_attempts(self):
        self._route('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1')
        self.session.get.reset_mock()
        response = self._route('project=product&sprint=123')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.session.get.call_count, 4)
        self.assertEqual(_failures(self.global_breaker), 1)
        self.assertEqual(_failures(self.epic_breaker), 1)

    def test_unbound_request_passes_the_global_breaker_and_no_attempt_override(self):
        resilient = Mock(return_value='ok')
        with patch.object(jira_server, 'resilient_jira_get', resilient):
            jira_server.current_jira_get('/rest/api/3/search/jql', params={})
        self.assertIs(resilient.call_args.kwargs['breaker'], self.global_breaker)
        self.assertNotIn('max_attempts', resilient.call_args.kwargs)

    def test_bound_request_passes_the_epic_breaker_and_two_attempts(self):
        resilient = Mock(return_value='ok')
        with patch.object(jira_server, 'resilient_jira_get', resilient):
            self.epic_refresh.epic_refresh_call(True, jira_server.current_jira_get, '/rest/api/3/search/jql', params={})
        self.assertIs(resilient.call_args.kwargs['breaker'], self.epic_breaker)
        self.assertEqual(resilient.call_args.kwargs['max_attempts'], 2)

    def test_binding_is_reset_after_success_and_after_an_exception(self):
        var = self.epic_refresh.EPIC_REFRESH_TRANSPORT
        seen = []
        self.epic_refresh.epic_refresh_call(True, lambda: seen.append(var.get()))
        self.assertIsNotNone(seen[0])
        self.assertIsNone(var.get())

        def boom():
            raise RuntimeError('jira down')

        with self.assertRaises(RuntimeError):
            self.epic_refresh.epic_refresh_call(True, boom)
        self.assertIsNone(var.get())

    def test_inactive_call_does_not_bind(self):
        seen = []
        self.epic_refresh.epic_refresh_call(False, lambda: seen.append(self.epic_refresh.EPIC_REFRESH_TRANSPORT.get()))
        self.assertEqual(seen, [None])

    def test_route_leaves_the_binding_reset(self):
        self._route('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1')
        self.assertIsNone(self.epic_refresh.EPIC_REFRESH_TRANSPORT.get())


if __name__ == '__main__':
    unittest.main()
