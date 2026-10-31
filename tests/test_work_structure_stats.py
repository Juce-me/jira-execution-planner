"""Promoted stats readers (plan Task 6A): Last N, mixed-era cohort ranges, Sprint-name periods, Track keys."""
import re
import unittest
from unittest.mock import Mock, patch

import jira_server
from backend.services import epic_cohort_closed
from tests.test_work_reader_routes import FakeSearch
from tests.test_work_structure_routes import WorkStructureRouteBase

LEGACY_SELECTORS = {'quarter': '2026Q4', 'configurationId': 'legacy', 'configurationRevision': 1}
DELIVERY_SELECTORS = {'quarter': '2027Q1', 'configurationId': 'delivery', 'configurationRevision': 1}


def closed_row(key, day, status='Done', project='PLAN'):
    return {'key': key, 'fields': {
        'summary': key, 'created': '2025-01-02T10:00:00.000+0000', 'status': {'name': status},
        'resolutiondate': f'{day}T10:00:00.000+0000', 'assignee': None, 'project': {'key': project}}}


def leaf_row(key, parent):
    return {'key': key, 'fields': {'parent': {'key': parent}}}


class StatsRouteBase(WorkStructureRouteBase):
    def setUp(self):
        super().setUp()
        self.promoted_seed()
        # Last N is an all-history report: it never admits a physical Sprint.
        self.stack.enter_context(patch.object(
            jira_server, 'resolve_request_catalog_sources', side_effect=AssertionError('Sprint admission')))
        self.stack.enter_context(patch.object(jira_server, 'jira_home_process_cache_enabled', return_value=False))

    def search(self, *responders):
        fake = FakeSearch(*responders)
        self.stack.enter_context(patch.object(jira_server, 'jira_search_request', side_effect=fake))
        return fake

    def post(self, path, body, client=None):
        client = client or self.client
        return client.post(path, json=body, headers=self.headers(client))

    def last_n(self, extra=None, selectors=None, search=None):
        body = {'mode': 'last_n', 'components': ['Comp A'], **(selectors or LEGACY_SELECTORS), **(extra or {})}
        return self.post('/api/stats/epic-cohort', body)


class LastNSelectorTests(StatsRouteBase):
    def test_every_selector_failure_precedes_scope_getters_and_jira(self):
        fake = self.search()
        scope = self.stack.enter_context(patch.object(
            jira_server, '_cohort_project_scope', side_effect=AssertionError('scope getter')))
        cases = (
            ({'mode': 'last_n', 'components': ['A']}, 409, 'configuration_required'),
            ({'mode': 'last_n', 'quarter': '2026Q4'}, 409, 'configuration_required'),
            ({'mode': 'last_n', 'quarter': '2026Q4', 'configurationId': 'legacy'}, 409, 'configuration_required'),
            ({'mode': 'last_n', 'quarter': '2026q4', 'configurationId': 'legacy', 'configurationRevision': 1},
             400, 'invalid_quarter'),
            ({'mode': 'last_n', 'quarter': 2026, 'configurationId': 'legacy', 'configurationRevision': 1},
             400, 'invalid_quarter'),
            ({'mode': 'last_n', **LEGACY_SELECTORS, 'configurationId': 'bad id'}, 400, 'invalid_configuration_id'),
            ({'mode': 'last_n', **LEGACY_SELECTORS, 'configurationId': 'nope'}, 400, 'invalid_configuration_id'),
            ({'mode': 'last_n', **LEGACY_SELECTORS, 'configurationRevision': 'x'}, 400, 'invalid_configuration_id'),
            ({'mode': 'last_n', **LEGACY_SELECTORS, 'configurationId': 'delivery'}, 409, 'configuration_scope_changed'),
            ({'mode': 'last_n', **LEGACY_SELECTORS, 'configurationRevision': 9}, 409, 'configuration_scope_changed'),
            ({'mode': 'last_n', **DELIVERY_SELECTORS, 'configurationId': 'legacy'}, 409, 'configuration_scope_changed'),
        )
        for body, status, code in cases:
            response = self.post('/api/stats/epic-cohort', {'components': ['A'], **body})
            self.assertEqual((response.status_code, response.get_json().get('error')), (status, code), body)
        scope.assert_not_called()
        self.assertEqual(fake.calls, [])

    def test_start_and_end_quarter_stay_forbidden(self):
        fake = self.search()
        response = self.last_n({'startQuarter': '2026Q1'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(fake.calls, [])

    def test_json_loaders_are_never_consulted(self):
        self.search()
        self.last_n()
        self.last_n(selectors=DELIVERY_SELECTORS)
        self.json_loader.assert_not_called()
        self.server_json_loader.assert_not_called()


class LastNEraTests(StatsRouteBase):
    def test_legacy_era_reads_epics_under_the_legacy_scope(self):
        fake = self.search(
            (r'resolutiondate is not EMPTY', [closed_row('OLD-3', '2026-03-01', project='OLD'),
                                              closed_row('OLD-1', '2026-03-01', project='OLD'),
                                              closed_row('OLD-2', '2026-04-01', 'Killed', project='OLD')]))
        response = self.last_n()
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        data = response.get_json()['data']
        self.assertEqual([row['key'] for row in data['issues']], ['OLD-2', 'OLD-1', 'OLD-3'])  # day desc, key asc
        self.assertEqual(data['meta']['scope'], 'components')
        self.assertIsNone(data['range'])
        resolved = [jql for jql in fake.calls if 'resolutiondate is not EMPTY' in jql][0]
        self.assertIn('issuetype = Epic', resolved)
        self.assertIn('project in ("OLD", "OLDB")', resolved)
        self.assertIn('component = "Comp A"', resolved)
        self.assertNotIn('PLAN', ' '.join(fake.calls))

    def test_delivery_era_qualifies_initiatives_through_matching_epic_leaves(self):
        fake = self.search(
            (r'issuetype = 10002 AND parent is not EMPTY', [leaf_row('PLAN-11', 'PLAN-1'), leaf_row('PLAN-12', 'PLAN-1'),
                                                           leaf_row('PLAN-21', 'PLAN-2')]),
            (r'issuetype = 10001 .*resolutiondate is not EMPTY', [closed_row('PLAN-1', '2027-02-01')]))
        response = self.last_n(selectors=DELIVERY_SELECTORS)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        data = response.get_json()['data']
        self.assertEqual([row['key'] for row in data['issues']], ['PLAN-1'])
        leaf = fake.calls[0]
        self.assertIn('project in ("PLAN")', leaf)
        self.assertIn('issuetype = 10002', leaf)
        self.assertIn('component = "Comp A"', leaf)
        parent = [jql for jql in fake.calls if 'resolutiondate is not EMPTY' in jql][0]
        self.assertIn('issuetype = 10001', parent)
        self.assertIn('key in ("PLAN-1","PLAN-2")', parent)
        self.assertNotIn('component', parent)  # the Initiative's own Components never decide membership
        self.assertNotIn('Epic', ' '.join(fake.calls))
        self.assertNotIn('OLD', ' '.join(fake.calls))

    def test_delivery_team_scope_uses_the_mapped_team_on_the_epic_leaf(self):
        fake = self.search((r'issuetype = 10002', [leaf_row('PLAN-11', 'PLAN-1')]),
                           (r'resolutiondate is not EMPTY', [closed_row('PLAN-1', '2027-02-01')]))
        response = self.post('/api/stats/epic-cohort',
                             {'mode': 'last_n', 'teamIds': ['t-1'], **DELIVERY_SELECTORS})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIn('cf[24] = "t-1"', fake.calls[0])
        self.assertEqual(response.get_json()['data']['meta']['scope'], 'teams')

    def test_components_win_over_teams_in_new_model_last_n(self):
        fake = self.search((r'issuetype = 10002', [leaf_row('PLAN-11', 'PLAN-1')]),
                           (r'resolutiondate is not EMPTY', [closed_row('PLAN-1', '2027-02-01')]))
        self.post('/api/stats/epic-cohort', {'mode': 'last_n', 'teamIds': ['t-1'], 'components': ['Comp A'],
                                             **DELIVERY_SELECTORS})
        self.assertIn('component = "Comp A"', fake.calls[0])
        self.assertNotIn('cf[24]', fake.calls[0])

    def test_no_matching_leaf_is_a_complete_empty_window(self):
        self.search()
        data = self.last_n(selectors=DELIVERY_SELECTORS).get_json()['data']
        self.assertEqual(data['issues'], [])
        self.assertFalse(data['meta']['truncated'])
        self.assertFalse(data['meta']['windowFull'])

    def test_failed_leaf_search_is_an_error_never_an_empty_window(self):
        def failing(payload, *args, **kwargs):
            return Mock(status_code=502, text='boom', json=Mock(return_value={}))
        self.stack.enter_context(patch.object(jira_server, 'jira_search_request', side_effect=failing))
        response = self.last_n(selectors=DELIVERY_SELECTORS)
        self.assertEqual(response.status_code, 502)

    def test_unscoped_last_n_makes_no_search_request_in_either_era(self):
        fake = self.search()
        for selectors in (LEGACY_SELECTORS, DELIVERY_SELECTORS):
            body = {'mode': 'last_n', **selectors}
            self.assertEqual(self.post('/api/stats/epic-cohort', body).status_code, 200)
        self.assertEqual(fake.calls, [])

    def test_ceiling_window_ties_and_unchanged_n_slicing(self):
        rows = [closed_row(f'PLAN-{n}', '2027-02-01') for n in range(100, 100 + 70)]
        self.search((r'issuetype = 10002', [leaf_row('PLAN-11', 'PLAN-1')]),
                    (r'resolutiondate is not EMPTY', rows))
        with patch.object(epic_cohort_closed, 'LAST_N_WINDOW', 60):
            data = self.last_n(selectors=DELIVERY_SELECTORS).get_json()['data']
        self.assertEqual(len(data['issues']), 60)  # N (30/50/60) stays client-only; the server window is fixed
        self.assertTrue(data['meta']['windowFull'])
        self.assertEqual(data['meta']['windowCeiling'], 60)
        keys = [row['key'] for row in data['issues']]
        self.assertEqual(keys, sorted(keys))  # same terminal day: key ascending

    def test_page_ceiling_marks_truncated(self):
        pages = {'n': 0}

        def pager(payload, *args, **kwargs):
            pages['n'] += 1
            response = Mock(status_code=200)
            response.json.return_value = {'issues': [leaf_row(f'PLAN-{pages["n"]}', 'PLAN-1')] if 'parent is not EMPTY' in payload['jql'] else [],
                                          'isLast': False, 'nextPageToken': 't'}
            return response
        self.stack.enter_context(patch.object(jira_server, 'jira_search_request', side_effect=pager))
        data = self.last_n(selectors=DELIVERY_SELECTORS).get_json()['data']
        self.assertEqual(pages['n'], epic_cohort_closed.MAX_TOTAL_PAGES)
        self.assertTrue(data['meta']['truncated'])
        self.assertTrue(any('truncated' in warning for warning in data['meta']['warnings']))


class LastNIsolationTests(StatsRouteBase):
    """Era isolation: the other configuration's state never matters and no era is merged."""

    def seed_blank_delivery(self):
        def mutate(bundle):
            legacy, delivery = bundle['configurations']
            legacy['scope']['projects'] = [{'key': 'OLD', 'type': 'product'}]
            legacy['scope']['boardId'] = '7001'
        self.seed(mutate=mutate)

    def test_usable_legacy_with_blank_delivery_serves_and_blank_delivery_is_incomplete(self):
        from backend.db import models
        with self.factory() as session:
            session.query(models.WorkspaceDashboardConfig).delete()
            session.commit()
        self.seed_blank_delivery()
        fake = self.search((r'resolutiondate is not EMPTY', [closed_row('OLD-1', '2026-03-01', project='OLD')]))
        legacy = self.last_n()
        self.assertEqual(legacy.status_code, 200, legacy.get_data(as_text=True))
        self.assertEqual([row['key'] for row in legacy.get_json()['data']['issues']], ['OLD-1'])
        before = len(fake.calls)
        delivery = self.last_n(selectors={**DELIVERY_SELECTORS, 'configurationRevision': 1})
        self.assertEqual((delivery.status_code, delivery.get_json()['error']), (409, 'configuration_incomplete'))
        self.assertEqual(len(fake.calls), before)  # no fallback to the Legacy era

    def test_incomplete_legacy_does_not_block_delivery(self):
        from backend.db import models
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            import json
            payload = json.loads(json.dumps(row.payload))
            payload['workConfigurations']['configurations'][0]['fields']['team'] = {'fieldId': '', 'fieldName': ''}
            row.payload = payload
            session.commit()
        self.search((r'issuetype = 10002', [leaf_row('PLAN-11', 'PLAN-1')]),
                    (r'resolutiondate is not EMPTY', [closed_row('PLAN-1', '2027-02-01')]))
        self.assertEqual(self.last_n(selectors=DELIVERY_SELECTORS).status_code, 200)
        self.assertEqual(self.last_n().get_json()['error'], 'configuration_incomplete')


class LastNCacheIdentityTests(unittest.TestCase):
    def key(self, configuration, quarter=''):
        return jira_server._build_epic_cohort_cache_key(
            quarter, quarter, ['t1'], ['PLAN'], ['A'], mode='last_n', configuration=configuration)

    def context(self, **overrides):
        base = {'configurationId': 'delivery', 'revision': 1, 'digest': 'abc'}
        return {**base, **overrides}

    def test_identity_is_mode_plus_configuration_revision_and_digest(self):
        base = self.key(self.context())
        self.assertTrue(base.startswith('last_n::'))
        self.assertNotEqual(base, self.key(self.context(revision=2)))
        self.assertNotEqual(base, self.key(self.context(digest='def')))
        self.assertNotEqual(base, self.key(self.context(configurationId='legacy')))
        self.assertNotEqual(base, self.key(None))

    def test_quarter_is_not_a_cache_dimension_inside_one_configuration(self):
        # The route sends '' for both quarters in last_n mode, so Q1 and Q2 of one configuration share a window.
        self.assertEqual(self.key(self.context()), self.key(self.context()))

    def test_ordered_per_era_list_is_part_of_range_identity(self):
        legacy, delivery = self.context(configurationId='legacy'), self.context()
        self.assertNotEqual(self.key([legacy, delivery]), self.key([delivery, legacy]))
        self.assertNotEqual(self.key([legacy, delivery]), self.key([legacy]))


class LastNRouteCacheTests(StatsRouteBase):
    def test_switching_quarter_inside_one_configuration_reuses_the_window(self):
        self.stack.enter_context(patch.object(jira_server, 'jira_home_process_cache_enabled', return_value=True))
        jira_server.EPIC_COHORT_CACHE.clear()
        fake = self.search((r'issuetype = 10002', [leaf_row('PLAN-11', 'PLAN-1')]),
                           (r'resolutiondate is not EMPTY', [closed_row('PLAN-1', '2027-02-01')]))
        first = self.last_n(selectors={**DELIVERY_SELECTORS, 'quarter': '2027Q1'})
        calls = len(fake.calls)
        second = self.last_n(selectors={**DELIVERY_SELECTORS, 'quarter': '2027Q3'})
        self.assertEqual((first.get_json()['cached'], second.get_json()['cached']), (False, True))
        self.assertEqual(len(fake.calls), calls)
        legacy = self.last_n()
        self.assertFalse(legacy.get_json()['cached'])  # crossing an era never reuses it
        jira_server.EPIC_COHORT_CACHE.clear()


def stats_row(key, status='Done', team='t1', points=3, project='PLAN'):
    return {'key': key, 'fields': {
        'status': {'name': status}, 'project': {'key': project, 'name': project}, 'priority': {'name': 'High'},
        'customfield_211': points, 'customfield_10004': points,
        'customfield_24': {'id': team, 'name': team}, 'customfield_30101': {'id': team, 'name': team}}}


class SprintNamePeriodTests(StatsRouteBase):
    """``/api/stats`` and burnout address a period by its quarter name; the name resolves the configuration."""

    def test_missing_or_non_quarter_period_has_exact_selector_errors(self):
        fake = self.search()
        cases = (
            ('/api/stats?sprint=Sprint%2012', 409, 'configuration_required'),
            ('/api/stats?sprint=2027Q1&quarter=2027q1', 400, 'invalid_quarter'),
            ('/api/stats?sprint=2027Q1&quarter=2027Q1&configurationId=legacy', 409, 'configuration_scope_changed'),
            ('/api/stats?sprint=2027Q1&quarter=2027Q1&configurationId=nope', 400, 'invalid_configuration_id'),
            ('/api/stats?sprint=2027Q1&quarter=2027Q1&configurationId=delivery&configurationRevision=7',
             409, 'configuration_scope_changed'),
            ('/api/stats/burnout?sprint=Sprint%2012', 409, 'configuration_required'),
        )
        for path, status, code in cases:
            response = self.client.get(path)
            self.assertEqual((response.status_code, response.get_json().get('error')), (status, code), path)
        self.assertEqual(fake.calls, [])

    def test_delivery_period_reads_epic_leaves_through_the_mapped_fields(self):
        fake = self.search((r'cf\[26\]', [stats_row('PLAN-1', points=8), stats_row('PLAN-2', 'To Do', points=5)]))
        response = self.client.get('/api/stats?sprint=2027Q1&teamIds=t1&groupId=g')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        data = response.get_json()['data']
        self.assertEqual((data['totals']['done'], data['totals']['incomplete']), (1, 1))
        self.assertEqual((data['totals']['donePoints'], data['totals']['incompletePoints']), (8.0, 5.0))
        self.assertEqual(list(data['projects']), ['other'])  # one combined lane from the configured project type
        jql = fake.calls[0]
        self.assertIn('project in ("PLAN")', jql)
        self.assertIn('issuetype = 10002', jql)
        self.assertIn('cf[24] = "t1"', jql)
        self.assertIn('cf[26] in ("2027Q1")', jql)
        self.assertNotIn('Team[Team]', jql)
        self.assertNotIn('OLD', jql)

    def test_legacy_period_keeps_its_exact_queries(self):
        fake = self.search((r'Sprint in', [stats_row('OLD-1', project='OLD')]))
        response = self.client.get('/api/stats?sprint=2026Q4&teamIds=t1')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        jql = fake.calls[0]
        self.assertIn('project in ("OLD", "OLDB")', jql)
        self.assertIn('"Team[Team]" = "t1"', jql)
        self.assertIn('Sprint in ("2026Q4")', jql)
        self.assertNotIn('issuetype', jql)

    def test_unavailable_period_is_an_error_not_zero(self):
        from backend.db import models
        import json
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            payload = json.loads(json.dumps(row.payload))
            payload['workConfigurations']['configurations'][1]['hierarchy']['planningIssueTypeId'] = None
            row.payload = payload
            session.commit()
        fake = self.search()
        response = self.client.get('/api/stats?sprint=2027Q1')
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'configuration_incomplete'))
        self.assertIn('hierarchy.planningIssueTypeId', response.get_json()['missingFields'])
        self.assertEqual(self.client.get('/api/stats?sprint=2026Q4').status_code, 200)
        self.assertEqual(len(fake.calls), 1)

    def test_burnout_resolves_the_configuration_and_never_reads_the_json_sprint_cache(self):
        fake = self.search()
        with patch.object(jira_server, 'load_sprints_cache', side_effect=AssertionError('JSON sprint cache')):
            response = self.post('/api/stats/burnout', {'sprint': '2027Q1', 'teamIds': ['t1']})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        jql = fake.calls[0]
        self.assertIn('cf[26] in ("2027Q1")', jql)
        self.assertIn('issuetype = 10002', jql)
        self.assertIn('status CHANGED TO', jql)

    def test_json_loaders_are_never_consulted(self):
        self.search()
        self.client.get('/api/stats?sprint=2027Q1')
        self.client.get('/api/stats?sprint=2026Q4')
        self.json_loader.assert_not_called()
        self.server_json_loader.assert_not_called()


class ExcludedCapacitySourceTests(StatsRouteBase):
    def setUp(self):
        super().setUp()
        from backend.routes import work_structure_routes as work_routes
        self.stack.enter_context(patch.object(jira_server, 'resolve_request_catalog_sources', return_value=[Mock()]))
        rows = {'11': ('legacy', '2026Q4'), '22': ('delivery', '2027Q1')}

        def admit(auth_context, sources, sprint_id, configuration_id=None, quarter=None):
            if sprint_id not in rows:
                raise work_routes.WorkConfigError('sprint_catalog_mismatch')
            config = Mock(configuration_id=rows[sprint_id][0])
            return config, {'id': int(sprint_id), 'name': rows[sprint_id][1]}
        self.stack.enter_context(patch.object(work_routes, 'admit_sprint_source', side_effect=admit))
        self.stack.enter_context(patch.object(jira_server, 'fetch_cached_excluded_capacity_epic_summaries',
                                              return_value={}))
        self.stack.enter_context(patch.object(jira_server, 'load_team_catalog', return_value={}))

    def issue(self, key, **fields):
        return {'id': key[-1], 'key': key, 'fields': {'summary': key, 'status': {'name': 'To Do'},
                                                       'project': {'key': 'PLAN'}, **fields}}

    def test_each_era_is_fetched_under_its_own_mapping_and_merged(self):
        fake = self.search((r'cf\[26\] in \(22\)', [self.issue('PLAN-1', customfield_211=8)]),
                           (r'Sprint in \(11\)', [self.issue('OLD-1', customfield_10004=5)]))
        response = self.post('/api/stats/excluded-capacity-source', {'sprintIds': ['11', '22']})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        issues = response.get_json()['data']['issues']
        self.assertEqual(sorted(item['key'] for item in issues), ['OLD-1', 'PLAN-1'])
        by_key = {item['key']: item['fields']['customfield_10004'] for item in issues}
        self.assertEqual(by_key, {'OLD-1': 5, 'PLAN-1': 8})
        self.assertEqual(len(fake.calls), 2)
        self.assertTrue(any('project in ("OLD", "OLDB")' in jql for jql in fake.calls))
        self.assertTrue(any('issuetype = 10002' in jql and 'project in ("PLAN")' in jql for jql in fake.calls))

    def test_unadmitted_sprint_is_a_catalog_mismatch_before_jira(self):
        fake = self.search()
        response = self.post('/api/stats/excluded-capacity-source', {'sprintIds': ['11', '99']})
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'sprint_catalog_mismatch'))
        self.assertEqual(fake.calls, [])

    def test_quarter_selector_that_disagrees_with_the_source_is_rejected(self):
        self.search()
        response = self.post('/api/stats/excluded-capacity-source',
                             {'sprintIds': ['22'], 'quarter': 'oops'})
        self.assertEqual((response.status_code, response.get_json()['error']), (400, 'invalid_quarter'))


class ProjectTrackKeyOnlyTests(StatsRouteBase):
    def test_key_only_input_needs_a_selected_quarter_and_uses_the_mapped_field(self):
        seen = []

        def fake_phase(key, track_field, context=None):
            seen.append(track_field)
            return key, {'key': key, 'summary': key, 'currentValue': None, 'durations': {}, 'created': None,
                         'transitions': []}, None
        self.stack.enter_context(patch.object(jira_server, '_fetch_epic_track_phase', side_effect=fake_phase))
        response = self.post('/api/stats/project-track-phase-durations', {'epicKeys': ['PLAN-1']})
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'configuration_required'))
        self.assertEqual(seen, [])
        # PLAN fixture maps no Project Track: an unmapped field is an incomplete configuration, never a default.
        response = self.post('/api/stats/project-track-phase-durations', {'epicKeys': ['PLAN-1'], **DELIVERY_SELECTORS})
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'configuration_incomplete'))
        self.assertEqual(seen, [])
        response = self.post('/api/stats/project-track-phase-durations', {'epicKeys': ['OLD-1'], **LEGACY_SELECTORS})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(seen, ['customfield_35024'])  # Legacy default Track field

    def test_empty_keys_are_still_a_plain_400(self):
        response = self.post('/api/stats/project-track-phase-durations', {'epicKeys': []})
        self.assertEqual(response.status_code, 400)


class MixedEraRangeTests(StatsRouteBase):
    def setUp(self):
        super().setUp()
        original = jira_server.parse_epic_cohort_request
        from datetime import date
        self.stack.enter_context(patch.object(
            jira_server, 'parse_epic_cohort_request',
            side_effect=lambda payload, reference_date=None: original(payload, reference_date=date(2027, 6, 1))))

    def closed(self, start, end, **extra):
        body = {'mode': 'closed', 'startQuarter': start, 'endQuarter': end, 'components': ['Comp A'], **extra}
        return self.post('/api/stats/epic-cohort', body)

    def test_range_partitions_at_the_configuration_boundary(self):
        fake = self.search(
            (r'issuetype = 10002 AND parent is not EMPTY', [leaf_row('PLAN-11', 'PLAN-1')]),
            (r'issuetype = Epic', [closed_row('OLD-1', '2026-11-05', project='OLD')]),
            (r'issuetype = 10001', [closed_row('PLAN-1', '2027-01-20')]))
        response = self.closed('2026Q4', '2027Q1')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        data = response.get_json()['data']
        self.assertEqual(sorted(row['key'] for row in data['issues']), ['OLD-1', 'PLAN-1'])
        self.assertEqual(data['range'], {'startDate': '2026-10-01', 'endDate': '2027-03-31'})
        legacy_jql = [jql for jql in fake.calls if 'issuetype = Epic' in jql]
        self.assertTrue(legacy_jql)
        # Legacy segment is bound to its own quarter range, never the whole request range.
        self.assertTrue(all('2027-03' not in jql and '2027-01-02' in jql for jql in legacy_jql))
        new_jql = [jql for jql in fake.calls if 'issuetype = 10001' in jql]
        self.assertTrue(all('2026-12-31' in jql and '2027-03-31' not in jql for jql in new_jql))
        self.assertNotIn('Epic', ' '.join(jql for jql in fake.calls if 'issuetype = 10' in jql))

    def test_incomplete_era_is_an_unavailable_period_not_zero(self):
        from backend.db import models
        import json
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            payload = json.loads(json.dumps(row.payload))
            payload['workConfigurations']['configurations'][1]['fields']['sprint'] = {'fieldId': '', 'fieldName': ''}
            row.payload = payload
            session.commit()
        fake = self.search((r'issuetype = Epic', [closed_row('OLD-1', '2026-11-05', project='OLD')]))
        data = self.closed('2026Q4', '2027Q1').get_json()['data']
        self.assertEqual([row['key'] for row in data['issues']], ['OLD-1'])
        self.assertEqual(data['meta']['unavailablePeriods'], [{
            'startQuarter': '2027Q1', 'endQuarter': '2027Q1', 'configurationId': 'delivery',
            'reason': 'configuration_incomplete'}])
        only_new = self.closed('2027Q1', '2027Q1')
        self.assertEqual((only_new.status_code, only_new.get_json()['error']), (409, 'configuration_incomplete'))
        self.assertEqual(len([jql for jql in fake.calls if 'PLAN' in jql]), 0)

    def test_created_mode_qualifies_initiatives_through_epic_leaves(self):
        fake = self.search(
            (r'issuetype = 10002 AND parent is not EMPTY', [leaf_row('PLAN-11', 'PLAN-1')]),
            (r'issuetype = 10001', [{'key': 'PLAN-1', 'fields': {
                'summary': 'PLAN-1', 'created': '2027-02-10T10:00:00.000+0000', 'status': {'name': 'Open'},
                'resolutiondate': None, 'assignee': None, 'project': {'key': 'PLAN'}}}]))
        response = self.post('/api/stats/epic-cohort', {
            'startQuarter': '2027Q1', 'endQuarter': '2027Q1', 'components': ['Comp A']})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual([row['key'] for row in response.get_json()['data']['issues']], ['PLAN-1'])
        parent = [jql for jql in fake.calls if 'issuetype = 10001' in jql][0]
        self.assertIn('key in ("PLAN-1")', parent)
        self.assertNotIn('component', parent)

    def test_range_cache_identity_lists_every_era_in_order(self):
        self.stack.enter_context(patch.object(jira_server, 'jira_home_process_cache_enabled', return_value=True))
        jira_server.EPIC_COHORT_CACHE.clear()
        self.search((r'issuetype = Epic', [closed_row('OLD-1', '2026-11-05', project='OLD')]),
                    (r'issuetype = 10002', [leaf_row('PLAN-11', 'PLAN-1')]),
                    (r'issuetype = 10001', [closed_row('PLAN-1', '2027-01-20')]))
        self.closed('2026Q4', '2027Q1')
        key = next(iter(jira_server.EPIC_COHORT_CACHE))
        self.assertLess(key.index('cfg:legacy:'), key.index('cfg:delivery:'))
        jira_server.EPIC_COHORT_CACHE.clear()


if __name__ == '__main__':
    unittest.main()
