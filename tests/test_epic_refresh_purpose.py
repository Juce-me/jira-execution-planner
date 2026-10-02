import dataclasses
import os
import time
import unittest
from contextlib import ExitStack
from unittest.mock import Mock, patch

from backend.auth.cache_policy import build_jira_home_process_cache_key
from tests.auth_mode_test_utils import force_basic_auth_mode
from tests.oauth_test_helpers import install_oauth_session
from tests.test_oauth_eng_routes import _local_oauth_context

try:
    import jira_server
    _IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # pragma: no cover
    jira_server = None
    _IMPORT_ERROR = exc

REAL = object()


def _mock_response(status_code, payload=None):
    response = Mock()
    response.status_code = status_code
    response.json.return_value = payload if payload is not None else {}
    return response


def _issue(key, epic='EPIC-1'):
    return {'id': key, 'key': key, 'fields': {
        'summary': f'Story {key}', 'status': {'name': 'To Do'}, 'priority': {'name': 'Medium'},
        'issuetype': {'name': 'Story'}, 'updated': '2026-09-30T10:00:00.000+0000',
        'customfield_10004': 3, 'customfield_epic_link': epic,
        'customfield_sprint': [{'id': 123, 'name': '2026Q3'}],
    }}


def _page(issues, last=True, token=None):
    body = {'issues': issues, 'names': {'customfield_epic_link': 'Epic Link', 'customfield_sprint': 'Sprint'},
            'total': len(issues), 'isLast': last}
    if token:
        body['nextPageToken'] = token
    return _mock_response(200, body)


def _routing_search(payload):
    if str(payload.get('jql', '')).startswith('issueKey in'):
        return _mock_response(200, {'issues': [{'key': 'EPIC-1', 'fields': {
            'summary': 'Epic', 'status': {'name': 'In Progress'}, 'priority': {'name': 'High'},
            'updated': '2026-09-30T10:00:00.000+0000'}}], 'isLast': True})
    return _page([_issue('S-1')])


def _key(purpose, lane='product', epic_keys=None):
    return jira_server.build_tasks_cache_key('123', 'default', lane, [], [], True, False, purpose, epic_keys, sprint_name='')


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class EpicRefreshPurposeTests(unittest.TestCase):
    def setUp(self):
        from backend.routes import eng_routes
        from backend.services import epic_refresh
        force_basic_auth_mode(self, jira_server)
        jira_server.app.testing = True
        self.client = jira_server.app.test_client()
        jira_server.TASKS_CACHE.clear()
        self.eng_routes = eng_routes
        self.epic_refresh = epic_refresh
        # The route guard keeps a module-level limiter; give every test a fresh, non-blocking one.
        eng_routes._EPIC_REFRESH_LIMITER = epic_refresh.EpicRefreshLimiter(min_interval_seconds=0)

    def _get(self, query, search, details=None):
        with ExitStack() as stack:
            for target, value in (
                ('build_base_jql', 'project = TEST'), ('get_selected_projects_typed', []),
                ('get_configured_issue_types', ['Story']), ('resolve_team_field_id', 'customfield_team'),
                ('resolve_epic_link_field_id', 'customfield_epic_link'), ('get_sprint_field_id', 'customfield_sprint'),
                ('get_project_track_field_id', 'customfield_track'), ('get_delivery_owner_field_id', ''),
            ):
                stack.enter_context(patch.object(jira_server, target, return_value=value))
            stack.enter_context(patch.object(jira_server, 'jira_search_request', search))
            details_mock = None
            if details is not REAL:
                details_mock = stack.enter_context(patch.object(
                    jira_server, 'fetch_epic_details_bulk', Mock(return_value=details if details is not None else {})))
            scan = stack.enter_context(patch.object(jira_server, 'fetch_epics_for_empty_alert', Mock(return_value=[])))
            response = self.client.get('/api/tasks-with-team-name?' + query)
        return response, details_mock, scan

    def test_missing_or_malformed_arguments_return_400_without_a_jira_call(self):
        search = Mock()
        for query in (
            'purpose=epic-refresh&project=product&sprint=123',
            'purpose=epic-refresh&project=product&epicKeys=EPIC-1',
            'purpose=epic-refresh&project=product&sprint=abc&epicKeys=EPIC-1',
            'purpose=epic-refresh&project=all&sprint=123&epicKeys=EPIC-1',
            'purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1,EPIC-2',
            'purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1%22%20OR%20project%20is%20not%20EMPTY',
            'purpose=epic-alerts&project=product&sprint=123',
            'purpose=epic-alerts&project=product&sprint=123&epicKeys=EPIC-1,EPIC-2',
            'purpose=ready-to-close&project=product&epicKeys=X)%20OR%20issueKey%20in%20(Y',
        ):
            response, _details, _scan = self._get(query, search)
            self.assertEqual(response.status_code, 400, query)
            self.assertIn(response.get_json()['error'], ('invalid_epic_refresh', 'invalid_epic_keys'))
        search.assert_not_called()

    def test_skips_the_empty_epic_scan_and_fetches_details_for_the_requested_key(self):
        search = Mock(side_effect=[_page([_issue('S-1')])])
        details = {'EPIC-1': {'key': 'EPIC-1', 'summary': 'Epic', 'status': 'In Progress'}}
        response, details_mock, scan = self._get(
            'purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1&refresh=true', search, details)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        scan.assert_not_called()
        self.assertEqual(details_mock.call_args.args[0], ['EPIC-1'])
        body = response.get_json()
        self.assertEqual(body['epics'], details)
        self.assertEqual(body['epicsInScope'], [])
        self.assertIs(body['capped'], False)
        self.assertEqual(body['epicKeysMissing'], [])
        story_jql = search.call_args_list[0].args[0]['jql']
        self.assertIn('Sprint = 123', story_jql)
        self.assertIn('"Epic Link" in ("EPIC-1")', story_jql)
        self.assertIn('parent in ("EPIC-1")', story_jql)

    def test_epic_with_no_stories_still_returns_its_details(self):
        search = Mock(side_effect=[_page([])])
        details = {'EPIC-1': {'key': 'EPIC-1', 'summary': 'Empty epic', 'status': 'In Progress'}}
        response, _d, _s = self._get('purpose=epic-refresh&project=tech&sprint=123&epicKeys=EPIC-1', search, details)
        body = response.get_json()
        self.assertEqual(body['issues'], [])
        self.assertEqual(body['epics'], details)
        self.assertEqual(body['epicKeysMissing'], [])

    def test_missing_details_are_reported_not_hidden(self):
        search = Mock(side_effect=[_page([_issue('S-1')])])
        response, _d, _s = self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1', search, {})
        self.assertEqual(response.get_json()['epicKeysMissing'], ['EPIC-1'])

    def test_capped_flag_when_250_rows_come_back(self):
        pages = [
            _page([_issue(f'S-{i}') for i in range(100)], last=False, token='t1'),
            _page([_issue(f'S-{i}') for i in range(100, 200)], last=False, token='t2'),
            _page([_issue(f'S-{i}') for i in range(200, 250)], last=True),
        ]
        response, _d, _s = self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1',
                                     Mock(side_effect=pages), {'EPIC-1': {'key': 'EPIC-1'}})
        self.assertEqual(len(response.get_json()['issues']), 250)
        self.assertIs(response.get_json()['capped'], True)

    def test_never_reads_or_writes_the_tasks_cache(self):
        stale_key = _key('epic-refresh', 'product', ['EPIC-1'])
        jira_server.TASKS_CACHE[stale_key] = {'timestamp': time.time(), 'data': {'issues': [{'key': 'STALE'}]}}
        before = dict(jira_server.TASKS_CACHE)
        search = Mock(side_effect=[_page([_issue('S-1')])])
        response, _d, _s = self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1', search,
                                     {'EPIC-1': {'key': 'EPIC-1'}})
        self.assertEqual([issue['key'] for issue in response.get_json()['issues']], ['S-1'])
        self.assertEqual(jira_server.TASKS_CACHE, before)

    def test_success_evicts_only_the_same_lane_dashboard_and_alerts_entries(self):
        now = time.time()
        for purpose, lane in (('dashboard', 'product'), ('alerts', 'product'), ('dashboard', 'tech')):
            jira_server.TASKS_CACHE[_key(purpose, lane)] = {'timestamp': now, 'data': {'issues': []}}
        search = Mock(side_effect=[_page([_issue('S-1')])])
        self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1', search, {'EPIC-1': {'key': 'EPIC-1'}})
        self.assertNotIn(_key('dashboard', 'product'), jira_server.TASKS_CACHE)
        self.assertNotIn(_key('alerts', 'product'), jira_server.TASKS_CACHE)
        self.assertIn(_key('dashboard', 'tech'), jira_server.TASKS_CACHE)

    def test_rate_limit_returns_429_with_retry_after(self):
        self.eng_routes._EPIC_REFRESH_LIMITER = self.epic_refresh.EpicRefreshLimiter(min_interval_seconds=8)
        search = Mock(side_effect=[_page([]), _page([])])
        query = 'purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-9'
        first, _d, _s = self._get(query, search, {'EPIC-9': {'key': 'EPIC-9'}})
        second, _d, _s = self._get(query, search, {'EPIC-9': {'key': 'EPIC-9'}})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
        self.assertEqual(second.get_json()['error'], 'epic_refresh_rate_limited')
        self.assertGreaterEqual(second.get_json()['retryAfterSeconds'], 1)
        self.assertEqual(second.headers.get('Retry-After'), str(second.get_json()['retryAfterSeconds']))
        self.assertEqual(search.call_count, 1)

    def test_both_lanes_of_one_click_do_not_rate_limit_each_other(self):
        self.eng_routes._EPIC_REFRESH_LIMITER = self.epic_refresh.EpicRefreshLimiter(min_interval_seconds=8)
        search = Mock(side_effect=[_page([]), _page([]), _page([])])
        details = {'EPIC-9': {'key': 'EPIC-9'}}
        product, _d, _s = self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-9', search, details)
        tech, _d, _s = self._get('purpose=epic-refresh&project=tech&sprint=123&epicKeys=EPIC-9', search, details)
        again, _d, _s = self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-9', search, details)
        self.assertEqual((product.status_code, tech.status_code, again.status_code), (200, 200, 429))

    def test_default_purpose_still_runs_the_empty_epic_scan(self):
        search = Mock(side_effect=[_page([_issue('S-1')])])
        response, _d, scan = self._get('project=product&sprint=123&epicKeys=EPIC-1', search, {})
        self.assertEqual(response.status_code, 200)
        scan.assert_called_once()

    def test_one_lane_call_costs_exactly_two_searches(self):
        search = Mock(side_effect=_routing_search)
        response, _d, scan = self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1', search, REAL)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(search.call_count, 2)  # one story page, one epic-details search
        scan.assert_not_called()
        self.assertEqual(list(response.get_json()['epics']), ['EPIC-1'])

    def test_refresh_uses_no_jira_write_path(self):
        # current_jira_request is the method-based request helper the inline edit routes use for Jira writes.
        search = Mock(side_effect=[_page([_issue('S-1')])])
        boom = Mock(side_effect=AssertionError('a Jira write path was touched'))
        with patch.object(jira_server, 'current_jira_request', boom):
            response, _d, _s = self._get('purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1', search,
                                         {'EPIC-1': {'key': 'EPIC-1'}})
        self.assertEqual(response.status_code, 200)
        boom.assert_not_called()


EPIC_ALERTS_QUERY = ('purpose=epic-alerts&project=product&sprint=123&sprintName=2026Q3&teamIds=team-a'
                     '&teamLabels=team_alpha&epicKeys=EPIC-1')


def _alert_epic(key='EPIC-1', sprint=True):
    return {'key': key, 'summary': 'Epic', 'status': {'name': 'In Progress'}, 'labels': ['team_alpha'],
            'fields': {'customfield_10101': [{'id': 123}] if sprint else []}}


def _distribution(**overrides):
    base = {'selectedStories': 2, 'selectedActionableStories': 1, 'futureOpenStories': 3,
            'openStoriesOutsideSelected': 4, 'selectedActionableByTeam': {'team-a': 1}}
    base.update(overrides)
    return {'EPIC-1': base}


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class EpicAlertsPurposeTests(unittest.TestCase):
    def setUp(self):
        from backend.routes import eng_routes
        from backend.services import epic_refresh
        force_basic_auth_mode(self, jira_server)
        jira_server.app.testing = True
        self.client = jira_server.app.test_client()
        jira_server.TASKS_CACHE.clear()
        self.eng_routes = eng_routes
        self.epic_refresh = epic_refresh
        eng_routes._EPIC_REFRESH_LIMITER = epic_refresh.EpicRefreshLimiter(min_interval_seconds=0)

    def _get(self, query, patches):
        with ExitStack() as stack:
            for target, value in (
                ('build_base_jql', 'project = TEST'), ('get_selected_projects_typed', []),
                ('get_configured_issue_types', ['Story']), ('resolve_team_field_id', 'customfield_team'),
                ('resolve_epic_link_field_id', 'customfield_epic_link'), ('get_sprint_field_id', 'customfield_sprint'),
            ):
                stack.enter_context(patch.object(jira_server, target, return_value=value))
            mocks = {name: stack.enter_context(patch.object(jira_server, name, mock)) for name, mock in patches.items()}
            response = self.client.get('/api/tasks-with-team-name?' + query)
        return response, mocks

    def _bundle(self, epics=None, counts=None, distribution=None, query=EPIC_ALERTS_QUERY):
        return self._get(query, {
            'fetch_epics_for_empty_alert': Mock(return_value=[_alert_epic()] if epics is None else epics),
            'fetch_story_counts_for_epics': Mock(return_value={'EPIC-1': 7} if counts is None else counts),
            'fetch_story_distribution_for_epics': Mock(return_value=_distribution() if distribution is None else distribution),
            'jira_search_request': Mock(side_effect=AssertionError('the story search must not run')),
        })

    def test_epic_search_jql_is_scoped_complete_and_ends_with_the_epic_key(self):
        epic_page = _mock_response(200, {'issues': [{'key': 'EPIC-1', 'fields': {
            'summary': 'Epic', 'status': {'name': 'In Progress'}, 'labels': ['team_alpha']}}], 'isLast': True})
        search = Mock(return_value=epic_page)
        response, _m = self._get(EPIC_ALERTS_QUERY, {
            'jira_search_request': search,
            'fetch_story_counts_for_epics': Mock(return_value={'EPIC-1': 1}),
            'fetch_story_distribution_for_epics': Mock(return_value=_distribution()),
        })
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = search.call_args_list[0].args[0]
        self.assertEqual(payload['maxResults'], 100)  # complete_alert_scope=True
        jql = payload['jql']
        self.assertIn('labels in ("2026Q3", "2026Q3_candidate")', jql)
        self.assertIn('"Team[Team]" = "team-a" OR labels = "team_alpha"', jql)
        self.assertTrue(jql.endswith('AND issueKey in ("EPIC-1")'), jql)
        self.assertEqual([epic['key'] for epic in response.get_json()['epicsInScope']], ['EPIC-1'])

    def test_a_failed_scope_search_is_a_500_never_an_empty_scope(self):
        search = Mock(return_value=_mock_response(503, {}))
        response, _m = self._get(EPIC_ALERTS_QUERY, {
            'jira_search_request': search,
            'fetch_story_counts_for_epics': Mock(return_value={}),
            'fetch_story_distribution_for_epics': Mock(return_value={}),
        })
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('epicsInScope', response.get_json())

    def test_bundle_returns_only_the_enriched_scope_for_the_one_epic(self):
        response, mocks = self._bundle()
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(list(body), ['epicsInScope'])
        for name in ('fetch_story_counts_for_epics', 'fetch_story_distribution_for_epics'):
            self.assertEqual(mocks[name].call_args.args[0], ['EPIC-1'])
        epic = body['epicsInScope'][0]
        self.assertEqual((epic['totalStories'], epic['selectedStories'], epic['selectedActionableStories']), (7, 2, 1))
        self.assertEqual((epic['futureOpenStories'], epic['openStoriesOutsideSelected']), (3, 4))
        self.assertEqual(epic['selectedActionableByTeam'], {'team-a': 1})
        # The /api/ after_request hook narrows Cache-Control to plain no-store; either way it is not cacheable.
        self.assertIn('no-store', response.headers['Cache-Control'])
        self.assertEqual(response.headers['Pragma'], 'no-cache')

    def test_an_epic_outside_the_scope_returns_an_empty_scope(self):
        response, mocks = self._bundle(epics=[])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'epicsInScope': []})
        mocks['fetch_story_counts_for_epics'].assert_not_called()

    def test_a_future_sprint_epic_in_scope_only_by_label_is_returned(self):
        response, _m = self._bundle(epics=[_alert_epic(sprint=False)])
        self.assertEqual([epic['key'] for epic in response.get_json()['epicsInScope']], ['EPIC-1'])

    def test_a_counts_or_distribution_failure_is_an_error_never_zero_counts(self):
        def failing(*_args, failures=None, **_kwargs):
            failures.append(503)
            return {'EPIC-1': 0}
        for name in ('fetch_story_counts_for_epics', 'fetch_story_distribution_for_epics'):
            patches = {
                'fetch_epics_for_empty_alert': Mock(return_value=[_alert_epic()]),
                'fetch_story_counts_for_epics': Mock(return_value={'EPIC-1': 7}),
                'fetch_story_distribution_for_epics': Mock(return_value=_distribution()),
            }
            patches[name] = Mock(side_effect=failing)
            response, _m = self._get(EPIC_ALERTS_QUERY, patches)
            self.assertIn(response.status_code, (500, 502), name)
            self.assertNotIn('epicsInScope', response.get_json(), name)

    def _run_real_fetcher(self, fetcher, *args, **kwargs):
        search = Mock(return_value=_mock_response(503, {}))
        with patch.object(jira_server, 'jira_search_request', search):
            result = getattr(jira_server, fetcher)(*args, **kwargs)
        return result, search

    def test_real_counts_fetcher_records_a_non_200_page_in_failures(self):
        failures = []
        counts, search = self._run_real_fetcher(
            'fetch_story_counts_for_epics', ['EPIC-1'], {}, 'customfield_epic_link', failures=failures)
        self.assertEqual(failures, [503])
        self.assertEqual(search.call_count, 1)
        self.assertEqual(counts, {'EPIC-1': 0})
        # Without the argument the historical zero-count fallback is unchanged and nothing raises.
        counts, _search = self._run_real_fetcher(
            'fetch_story_counts_for_epics', ['EPIC-1'], {}, 'customfield_epic_link')
        self.assertEqual(counts, {'EPIC-1': 0})

    def test_real_distribution_fetcher_records_every_failed_page_with_a_selected_sprint(self):
        failures = []
        distribution, search = self._run_real_fetcher(
            'fetch_story_distribution_for_epics', ['EPIC-1'], {}, 'customfield_epic_link', '123', failures=failures)
        # selected-sprint, future-sprint and outside-selected queries each fail once
        self.assertEqual(failures, [503, 503, 503])
        self.assertEqual(search.call_count, 3)
        self.assertEqual(distribution['EPIC-1']['selectedStories'], 0)
        distribution, _search = self._run_real_fetcher(
            'fetch_story_distribution_for_epics', ['EPIC-1'], {}, 'customfield_epic_link', '123')
        self.assertEqual(distribution, _distribution(
            selectedStories=0, selectedActionableStories=0, futureOpenStories=0,
            openStoriesOutsideSelected=0, selectedActionableByTeam={}))

    def test_real_distribution_fetcher_records_the_bucket_page_failures_without_a_selected_sprint(self):
        failures = []
        distribution, search = self._run_real_fetcher(
            'fetch_story_distribution_for_epics', ['EPIC-1'], {}, 'customfield_epic_link', '', failures=failures)
        # no selected-sprint query: only the future and outside-selected bucket queries run
        self.assertEqual(failures, [503, 503])
        self.assertEqual(search.call_count, 2)
        distribution_without, _search = self._run_real_fetcher(
            'fetch_story_distribution_for_epics', ['EPIC-1'], {}, 'customfield_epic_link', '')
        self.assertEqual(distribution_without, distribution)

    def test_alerts_follow_a_refresh_of_the_same_epic_and_lane_without_a_rate_limit(self):
        self.eng_routes._EPIC_REFRESH_LIMITER = self.epic_refresh.EpicRefreshLimiter(min_interval_seconds=8)
        refresh_query = 'purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1'
        first, _m = self._get(refresh_query, {
            'jira_search_request': Mock(side_effect=[_page([_issue('S-1')])]),
            'fetch_epic_details_bulk': Mock(return_value={'EPIC-1': {'key': 'EPIC-1'}}),
        })
        alerts, _m = self._bundle()
        again, _m = self._bundle()
        self.assertEqual((first.status_code, alerts.status_code, again.status_code), (200, 200, 429))

    def test_missing_epic_keys_is_a_400_and_nothing_is_cached(self):
        response, mocks = self._bundle(query='purpose=epic-alerts&project=product&sprint=123')
        self.assertEqual(response.status_code, 400)
        mocks['fetch_epics_for_empty_alert'].assert_not_called()
        ok, _m = self._bundle()
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(dict(jira_server.TASKS_CACHE), {})

    def test_a_call_costs_five_searches_on_the_dedicated_breaker(self):
        seen = []

        def search(payload):
            seen.append(self.epic_refresh.epic_refresh_transport().get('breaker'))
            if str(payload['jql']).endswith('issueKey in ("EPIC-1")'):
                return _mock_response(200, {'issues': [{'key': 'EPIC-1', 'fields': {'summary': 'Epic'}}], 'isLast': True})
            return _mock_response(200, {'issues': [], 'isLast': True})
        response, _m = self._get(EPIC_ALERTS_QUERY, {'jira_search_request': Mock(side_effect=search)})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        # 1 scope + 1 counts + 3 distribution (selected, future, outside selected)
        self.assertEqual(seen, [self.epic_refresh.EPIC_REFRESH_CIRCUIT_BREAKER] * 5)
        self.assertEqual(response.get_json()['epicsInScope'][0]['totalStories'], 0)
        self.assertIsNone(self.epic_refresh.EPIC_REFRESH_TRANSPORT.get())

    def test_the_alerts_purpose_still_runs_the_complete_scan_for_the_whole_scope(self):
        response, mocks = self._get('purpose=alerts&project=product&sprint=123&sprintName=2026Q3&teamIds=team-a', {
            'fetch_epics_for_empty_alert': Mock(return_value=[]),
            'jira_search_request': Mock(return_value=_page([])),
        })
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIs(mocks['fetch_epics_for_empty_alert'].call_args.kwargs.get('complete_alert_scope')
                      or mocks['fetch_epics_for_empty_alert'].call_args.args[-1], True)
        self.assertNotIn('epic_keys', mocks['fetch_epics_for_empty_alert'].call_args.kwargs)


OAUTH_QUERY = 'purpose=epic-refresh&project=product&sprint=123&epicKeys=EPIC-1'


def _http_response(payload):
    response = Mock()
    response.status_code = 200
    response.json.return_value = payload
    response.text = ''
    return response


@unittest.skipIf(jira_server is None, f'jira_server import unavailable: {_IMPORT_ERROR}')
class EpicRefreshOAuthTests(unittest.TestCase):
    def setUp(self):
        from backend.routes import eng_routes
        from backend.services import epic_refresh
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        env_patcher = patch.dict(os.environ, {
            'CONFIG_STORAGE_BACKEND': 'jsonfile', 'DATABASE_URL': '', 'TEST_DATABASE_URL': '',
        }, clear=False)
        env_patcher.start()
        self.addCleanup(env_patcher.stop)
        self.client = jira_server.app.test_client()
        self.stored_at = time.time()
        install_oauth_session(self.client, stored_at=self.stored_at)
        self.context = _local_oauth_context(stored_at=self.stored_at)
        jira_server.TASKS_CACHE.clear()
        self.addCleanup(jira_server.TASKS_CACHE.clear)
        self.addCleanup(jira_server.OAUTH_TOKEN_STORE.clear)
        self.addCleanup(jira_server.OAUTH_REFRESH_LOCKS.clear)
        eng_routes._EPIC_REFRESH_LIMITER = epic_refresh.EpicRefreshLimiter(min_interval_seconds=0)

    def _partitioned(self, context, purpose, lane='product', epic_keys=None):
        return build_jira_home_process_cache_key(context, _key(purpose, lane, epic_keys))

    def _get(self, query=OAUTH_QUERY, http_get=None, extra_patches=()):
        http_get = http_get or Mock(side_effect=self._routing_http_get)
        with ExitStack() as stack:
            stack.enter_context(patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'))
            for target, value in (
                ('build_base_jql', 'project = TEST'), ('get_selected_projects_typed', []),
                ('get_configured_issue_types', ['Story']), ('resolve_team_field_id', 'customfield_team'),
                ('resolve_epic_link_field_id', 'customfield_epic_link'), ('get_sprint_field_id', 'customfield_sprint'),
                ('get_story_points_field_id', 'customfield_10004'),
            ):
                stack.enter_context(patch.object(jira_server, target, return_value=value))
            stack.enter_context(patch.object(jira_server, 'resilient_jira_get', http_get))
            stack.enter_context(patch.object(jira_server, 'fetch_epics_for_empty_alert', Mock(return_value=[])))
            for patcher in extra_patches:
                stack.enter_context(patcher)
            response = self.client.get('/api/tasks-with-team-name?' + query)
        return response, http_get

    @staticmethod
    def _routing_http_get(url, **kwargs):
        jql = str((kwargs.get('params') or {}).get('jql', ''))
        if jql.startswith('issueKey in'):
            return _http_response({'issues': [{'key': 'EPIC-1', 'fields': {
                'summary': 'Epic', 'status': {'name': 'In Progress'}, 'priority': {'name': 'High'},
                'updated': '2026-09-30T10:00:00.000+0000'}}], 'isLast': True})
        return _page([_issue('S-1')])

    def test_oauth_refresh_evicts_only_this_users_partitioned_entries(self):
        other = dataclasses.replace(
            self.context, user_id='local-oauth-user:account-999', auth_connection_id='local-oauth-connection:other')
        now = time.time()
        mine = {purpose: self._partitioned(self.context, purpose) for purpose in ('dashboard', 'alerts')}
        mine_tech = self._partitioned(self.context, 'dashboard', 'tech')
        theirs = {purpose: self._partitioned(other, purpose) for purpose in ('dashboard', 'alerts')}
        raw_dashboard = _key('dashboard', 'product')
        for key in (*mine.values(), mine_tech, *theirs.values()):
            self.assertIsInstance(key, tuple)
        for key in (*mine.values(), mine_tech, *theirs.values(), raw_dashboard):
            jira_server.TASKS_CACHE[key] = {'timestamp': now, 'data': {'issues': []}}
        before = set(jira_server.TASKS_CACHE)
        response, _http = self._get()
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['epicKeysMissing'], [])
        for key in mine.values():
            self.assertNotIn(key, jira_server.TASKS_CACHE)
        for key in (mine_tech, *theirs.values(), raw_dashboard):
            self.assertIn(key, jira_server.TASKS_CACHE)
        self.assertEqual(set(jira_server.TASKS_CACHE), before - set(mine.values()))
        self.assertFalse([key for key in jira_server.TASKS_CACHE if key not in before])

    def test_oauth_refresh_writes_no_tasks_cache_entry(self):
        response, _http = self._get()
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(dict(jira_server.TASKS_CACHE), {})

    def test_unauthenticated_oauth_request_returns_the_auth_required_payload(self):
        client = jira_server.app.test_client()  # no OAuth session installed
        http_get = Mock()
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'resilient_jira_get', http_get):
            response = client.get('/api/tasks-with-team-name?' + OAUTH_QUERY)
        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'auth_required')
        http_get.assert_not_called()

    def test_unauthenticated_oauth_epic_alerts_request_returns_the_auth_required_payload(self):
        client = jira_server.app.test_client()  # no OAuth session installed
        http_get = Mock()
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'resilient_jira_get', http_get), \
             patch.object(jira_server, 'jira_search_request', Mock()) as search:
            response = client.get('/api/tasks-with-team-name?' + EPIC_ALERTS_QUERY)
        self.assertEqual(response.status_code, 401, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['error'], 'auth_required')
        http_get.assert_not_called()
        search.assert_not_called()

    def test_epic_alerts_for_a_lane_the_user_may_not_access_is_a_403_without_a_jira_search(self):
        from backend.auth.context import ProjectAccessSnapshot
        from tests.test_db_project_access import auth_context
        context = auth_context(project_access=[
            ProjectAccessSnapshot(project_key='PROD', project_type='product', status='inaccessible'),
            ProjectAccessSnapshot(project_key='TECH', project_type='tech', status='accessible'),
        ])
        http_get = Mock()
        search = Mock()
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
             patch.object(jira_server, 'current_request_auth_context', return_value=context), \
             patch.object(jira_server, 'resilient_jira_get', http_get), \
             patch.object(jira_server, 'jira_search_request', search):
            response = self.client.get('/api/tasks-with-team-name?' + EPIC_ALERTS_QUERY)
        self.assertEqual(response.status_code, 403, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body['error'], 'missing_project_access')
        self.assertEqual(body['projectType'], 'product')
        http_get.assert_not_called()
        search.assert_not_called()

    def test_oauth_refresh_uses_only_the_per_user_context(self):
        forbidden = AssertionError('a service-account or write credential path was touched')
        write_and_basic = (
            patch('backend.auth.user_api_tokens._basic_auth_header', side_effect=forbidden),
            patch('backend.auth.jira_auth.jira_request', side_effect=forbidden),
            patch('backend.auth.jira_auth.jira_post', side_effect=forbidden),
            patch.object(jira_server, 'current_jira_request', side_effect=forbidden),
        )
        response, http_get = self._get(extra_patches=write_and_basic)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(http_get.call_count, 2)
        for call in http_get.call_args_list:
            self.assertEqual(call.kwargs['headers']['Authorization'], 'Bearer access-123')


if __name__ == '__main__':
    unittest.main()
