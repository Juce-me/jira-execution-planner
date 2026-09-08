import os
import unittest
from contextlib import ExitStack
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch

from flask import Flask, has_request_context, jsonify
from backend import jira_client
from backend.services import request_performance as perf


class RequestPerformanceTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        environment = patch.dict(os.environ, {'DATABASE_URL': 'sqlite://'})
        environment.start()
        self.addCleanup(environment.stop)

    def response(self, enabled=True, query='?debugTimings=true', cache=False, capped=False):
        @perf.measure_task_load
        def endpoint():
            if cache:
                perf.mark_task_cache_hit('capped' if capped else 'unknown')
            else:
                session = Mock()
                session.get.side_effect = [Mock(status_code=503), Mock(status_code=200)]
                with ThreadPoolExecutor(max_workers=1) as pool:
                    perf.submit_with_performance(pool, jira_client.resilient_jira_get,
                        'https://jira.example/rest/api/3/search/jql', session=session,
                        breaker=jira_client.JiraCircuitBreaker(), sleep_fn=lambda _: None,
                        rand_fn=lambda: 0).result()
                self.assertNotIn('stream', session.get.call_args.kwargs)
            return jsonify({'issues': [{}] * (250 if capped else 1)})
        with patch.dict(os.environ, {'APP_PERFORMANCE_DEBUG': str(enabled).lower()}), self.app.test_request_context('/' + query):
            return endpoint()

    def test_physical_attempt_retry_and_successful_search_pages_include_workers(self):
        response = self.response()
        self.assertEqual(response.json['loadMetrics'], {
            'jiraRequests': 2, 'jiraPages': 1, 'jiraRetries': 1,
            'cacheState': 'miss', 'completeness': 'unknown'})
        self.assertIn('total;dur=', response.headers['Server-Timing'])
        self.assertIsNone(perf.current_observer())

    def test_both_debug_gates_required(self):
        self.assertNotIn('loadMetrics', self.response(enabled=False).json)
        self.assertNotIn('loadMetrics', self.response(query='').json)

    def test_collection_flag_accepts_same_values_as_app_configuration(self):
        @perf.measure_task_load
        def endpoint():
            return jsonify({'issues': []})
        for flag in ('true', '1', 'yes'):
            with self.subTest(flag=flag), patch.dict(os.environ, {'APP_PERFORMANCE_DEBUG': flag}), \
                    self.app.test_request_context('/?debugTimings=true'):
                self.assertIn('loadMetrics', endpoint().json)

    def test_cap_is_visible_and_cache_hits_do_not_report_original_requests(self):
        self.assertEqual(self.response(capped=True).json['loadMetrics']['completeness'], 'capped')
        metrics = self.response(cache=True, capped=True).json['loadMetrics']
        self.assertEqual(metrics, {'jiraRequests': 0, 'jiraPages': 0, 'jiraRetries': 0,
                                  'cacheState': 'hit', 'completeness': 'capped'})

    def test_exception_resets_context(self):
        @perf.measure_task_load
        def endpoint():
            raise ValueError('test')
        with patch.dict(os.environ, {'APP_PERFORMANCE_DEBUG': 'true'}), self.app.test_request_context('/?debugTimings=true'):
            with self.assertRaises(ValueError):
                endpoint()
        self.assertIsNone(perf.current_observer())

    def test_real_tasks_cache_does_not_leak_debug_metrics(self):
        import jira_server as server
        from tests.auth_mode_test_utils import force_basic_auth_mode
        force_basic_auth_mode(self, server)
        values = {'build_base_jql': 'project = TEST', 'get_configured_issue_types': [],
                  'resolve_team_field_id': 'customfield_team', 'resolve_epic_link_field_id': 'customfield_epic',
                  'get_sprint_field_id': 'customfield_sprint', 'load_dashboard_config': {},
                  'fetch_epic_details_bulk': {}, 'fetch_epics_for_empty_alert': []}
        cache = {}
        with ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, {'APP_PERFORMANCE_DEBUG': 'true'}))
            stack.enter_context(patch.object(server, 'TASKS_CACHE', cache))
            for name, value in values.items():
                stack.enter_context(patch.object(server, name, return_value=value))
            stack.enter_context(patch.object(server, 'jira_search_request', return_value=Mock(
                status_code=200, json=Mock(return_value={'issues': [], 'isLast': True}))))
            client = server.app.test_client()
            first = client.get('/api/tasks-with-team-name?debugTimings=true')
            self.assertEqual(first.status_code, 200)
            self.assertIn('loadMetrics', first.json)
            second = client.get('/api/tasks-with-team-name?debugTimings=true')
            self.assertEqual(second.json['loadMetrics']['cacheState'], 'hit')
            plain = client.get('/api/tasks-with-team-name')
            self.assertNotIn('loadMetrics', plain.json)
            self.assertNotIn('debugTimingsMs', plain.json)
            self.assertTrue(cache)
            self.assertTrue(all('loadMetrics' not in item['data'] for item in cache.values()))

    def test_worker_reaches_real_jira_auth_wrapper_without_flask_context(self):
        import jira_server as server
        from tests.auth_mode_test_utils import force_basic_auth_mode
        force_basic_auth_mode(self, server)

        def worker(context):
            self.assertFalse(has_request_context())
            return server.current_jira_get('/rest/api/3/search/jql', context=context)

        @perf.measure_task_load
        def endpoint():
            context = server.current_request_auth_context()
            with ThreadPoolExecutor(max_workers=1) as pool:
                response = perf.submit_with_performance(pool, worker, context).result()
            self.assertEqual(response.status_code, 200)
            return jsonify({'issues': []})

        with patch.dict(os.environ, {'APP_PERFORMANCE_DEBUG': 'true'}), \
                patch.object(server, 'HTTP_SESSION', Mock(get=Mock(return_value=Mock(status_code=200)))), \
                patch.object(server, 'JIRA_SEARCH_CIRCUIT_BREAKER', jira_client.JiraCircuitBreaker()), \
                server.app.test_request_context('/?debugTimings=true'):
            result = endpoint()
        self.assertEqual(result.json['loadMetrics']['jiraRequests'], 1)
        self.assertEqual(result.json['loadMetrics']['jiraPages'], 1)
