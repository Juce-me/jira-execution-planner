"""Promoted work readers (plan Task 4A/4C backend): selector matrix, one-lane reads, readiness, Board."""
import json
import re
import unittest
from unittest.mock import Mock, patch

import jira_server
from backend.routes import work_structure_routes as work_routes
from backend.services import eng_board
from backend.services import work_structure as ws
from tests.test_work_structure_routes import WorkStructureRouteBase, jira_response

SPRINT_FIELD, POINTS_FIELD, TEAM_FIELD = 'customfield_26', 'customfield_211', 'customfield_24'


class FakeSearch:
    """Scripted ``jira_search_request``: first matching responder wins; every JQL is recorded."""

    def __init__(self, *responders):
        self.responders = list(responders)
        self.calls = []

    def __call__(self, payload, *args, **kwargs):
        self.calls.append(payload['jql'])
        for pattern, rows in self.responders:
            if re.search(pattern, payload['jql']):
                rows = rows(payload) if callable(rows) else rows
                return jira_response(200, {'issues': rows, 'isLast': True})
        return jira_response(200, {'issues': [], 'isLast': True})


def epic_row(key, parent=None, points=None, team=None, sprint=None, status='To Do', components=()):
    fields = {'summary': key, 'status': {'id': '1', 'name': status},
              'issuetype': {'id': '10002', 'name': 'Epic'}, 'project': {'key': 'PLAN', 'name': 'Plan'},
              POINTS_FIELD: points, 'components': [{'name': c} for c in components]}
    if parent:
        fields['parent'] = {'key': parent, 'fields': {'summary': parent, 'issuetype': {'id': '10001', 'name': 'Initiative'}}}
    if team:
        fields[TEAM_FIELD] = {'id': team, 'name': team}
    if sprint:
        fields[SPRINT_FIELD] = [{'id': sprint}]
    return {'key': key, 'id': key[-1], 'fields': fields}


def initiative_row(key, parent=None, labels=(), status='To Do'):
    fields = {'summary': key, 'status': {'id': '1', 'name': status},
              'issuetype': {'id': '10001', 'name': 'Initiative'}, 'project': {'key': 'PLAN'},
              'labels': list(labels), 'components': []}
    if parent:
        fields['parent'] = {'key': parent}
    return {'key': key, 'id': key[-1], 'fields': fields}


class SelectorMatrixTests(WorkStructureRouteBase):
    """Every matrix route returns the exact selector codes before any Jira request."""

    ROUTES = (
        ('get', '/api/tasks', {}), ('get', '/api/tasks-with-team-name', {}),
        ('get', '/api/missing-info', {'sprint': '5'}), ('get', '/api/backlog-epics', {}),
        ('get', '/api/issues/subtasks', {'parentKey': 'PLAN-1', 'sprint': '5'}),
        ('get', '/api/issues/lookup', {'keys': 'PLAN-1'}), ('post', '/api/dependencies', {}),
        ('get', '/api/teams/resolve', {'teamIds': 't1'}),
        ('get', '/api/eng/story-readiness',
         {'sprint': '5', 'sprintName': '2027Q1', 'sprintState': 'active', 'groupId': 'g'}),
    )

    def setUp(self):
        super().setUp()
        self.promoted_seed()
        self.search = FakeSearch()
        for target in ('jira_search_request',):
            self.stack.enter_context(patch.object(jira_server, target, side_effect=self.search))

    def call(self, method, path, params, extra=None):
        query = {**params, **(extra or {})}
        if method == 'post':
            return self.client.post(path, query_string=query, json={'keys': ['PLAN-1']}, headers=self.headers())
        return self.client.get(path, query_string=query)

    def test_malformed_missing_and_mismatched_selectors_have_exact_codes(self):
        cases = (
            ({}, 409, 'configuration_required'),
            ({'quarter': '2027q1'}, 400, 'invalid_quarter'),
            ({'quarter': '2027Q1', 'configurationId': 'bad id'}, 400, 'invalid_configuration_id'),
            ({'quarter': '2027Q1', 'configurationId': 'nope'}, 400, 'invalid_configuration_id'),
            ({'quarter': '2027Q1', 'configurationId': 'legacy'}, 409, 'configuration_scope_changed'),
            ({'quarter': '2027Q1', 'configurationId': 'delivery', 'configurationRevision': '9'},
             409, 'configuration_scope_changed'),
        )
        for method, path, params in self.ROUTES:
            for extra, status, code in cases:
                response = self.call(method, path, params, extra)
                self.assertEqual((response.status_code, response.get_json().get('error')), (status, code),
                                 (path, extra, response.get_data(as_text=True)))
        self.assertEqual(self.search.calls, [])  # every rejection precedes Jira

    def test_duplicate_selector_values_are_rejected(self):
        response = self.client.get('/api/tasks?quarter=2027Q1&quarter=2027Q2')
        self.assertEqual((response.status_code, response.get_json()['error']), (400, 'invalid_quarter'))
        response = self.client.get('/api/tasks?quarter=2027Q1&configurationId=delivery&configurationId=delivery')
        self.assertEqual((response.status_code, response.get_json()['error']), (400, 'invalid_configuration_id'))

    def test_incomplete_selected_configuration_is_409_with_paths(self):
        def clear_team(bundle):
            # Team is one field for every configuration: clearing it in Legacy leaves DELIVERY without one.
            bundle['configurations'][0]['fields']['team'] = {'fieldId': '', 'fieldName': ''}
        with self.factory() as session:
            from backend.db import models
            row = session.query(models.WorkspaceDashboardConfig).one()
            payload = json.loads(json.dumps(row.payload))
            clear_team(payload['workConfigurations'])
            row.payload = payload
            session.commit()
        response = self.client.get('/api/tasks?quarter=2027Q1')
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'configuration_incomplete'))
        self.assertIn('fields.team.fieldId', response.get_json()['missingFields'])

    def test_unknown_sprint_is_a_catalog_mismatch(self):
        with patch.object(jira_server, 'resolve_request_catalog_sources', return_value=[]):
            response = self.client.get('/api/tasks?quarter=2027Q1&sprint=5')
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'sprint_catalog_mismatch'))
        response = self.client.get('/api/tasks?quarter=2027Q1&sprint=5%20OR%201=1')
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'sprint_catalog_mismatch'))

    def test_json_loaders_are_never_consulted(self):
        self.client.get('/api/tasks')
        self.client.get('/api/tasks?quarter=2027Q1')
        self.json_loader.assert_not_called()
        self.server_json_loader.assert_not_called()


class PromotedTasksTests(WorkStructureRouteBase):
    def setUp(self):
        super().setUp()
        self.promoted_seed()
        self.sources = self.stack.enter_context(patch.object(
            jira_server, 'resolve_request_catalog_sources', return_value=[Mock()]))
        self.stack.enter_context(patch.object(
            work_routes, 'admit_sprint_source', return_value=(Mock(), {'id': 5, 'name': '2027Q1'})))

    def run_tasks(self, params, search):
        with patch.object(jira_server, 'jira_search_request', side_effect=search):
            return self.client.get('/api/tasks', query_string=params)

    def test_delivery_reads_epics_through_parent_with_one_unfiltered_request_lane(self):
        search = FakeSearch(
            (r'issuetype = 10002', [epic_row('PLAN-1', parent='PLAN-I1', points=8, team='t1', sprint=5),
                                    epic_row('PLAN-2', parent='PLAN-I1', points=None, team='t1', sprint=5)]),
            (r'issueKey in', [initiative_row('PLAN-I1')]),
        )
        response = self.run_tasks({'quarter': '2027Q1', 'sprint': '5', 'teamIds': 't1'}, search)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        main = [jql for jql in search.calls if 'issuetype = 10002' in jql]
        self.assertEqual(len(main), 1)
        self.assertIn('project in ("PLAN")', main[0])
        self.assertNotIn('OLD', main[0])
        self.assertIn('cf[24] = "t1"', main[0])
        self.assertIn('cf[26] = 5', main[0])
        self.assertNotIn('Epic Link', ' '.join(search.calls))
        self.assertEqual({issue['key']: issue['fields']['epicKey'] for issue in body['issues']},
                         {'PLAN-1': 'PLAN-I1', 'PLAN-2': 'PLAN-I1'})
        # Null points stay null; SP read from the mapped field, response key unchanged.
        self.assertEqual([issue['fields']['customfield_10004'] for issue in body['issues']], [8, None])
        self.assertEqual(body['teamFieldId'], TEAM_FIELD)

    def test_legacy_era_keeps_story_epic_semantics_inside_its_adapter(self):
        search = FakeSearch((r'type = "Story"', []),)
        response = self.run_tasks({'quarter': '2026Q4', 'sprint': '5'}, search)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        main = search.calls[0]
        self.assertIn('type = "Story"', main)
        self.assertIn('project in ("OLD", "OLDB")', main)
        self.assertIn('Sprint = 5', main)

    def test_promoted_cache_key_separates_configurations(self):
        search = FakeSearch((r'issuetype = 10002', []),)
        self.run_tasks({'quarter': '2027Q1'}, search)
        first = len(search.calls)
        self.run_tasks({'quarter': '2027Q1'}, search)  # same configuration: served from cache
        self.assertEqual(len(search.calls), first)
        self.run_tasks({'quarter': '2026Q4'}, search)  # other configuration: never shares a key
        self.assertGreater(len(search.calls), first)

    def test_promoted_request_never_reads_flat_getters(self):
        boom = AssertionError('flat structural getter used on a promoted read')
        with patch.object(jira_server, 'get_team_field_id', side_effect=boom), \
                patch.object(jira_server, 'get_sprint_field_id', side_effect=boom), \
                patch.object(jira_server, 'get_story_points_field_id', side_effect=boom), \
                patch.object(jira_server, 'get_configured_issue_types', side_effect=boom), \
                patch.object(jira_server, 'get_selected_projects_typed', side_effect=boom), \
                patch.object(jira_server, 'build_base_jql', side_effect=boom), \
                patch.object(jira_server, 'resolve_team_field_id', side_effect=boom):
            response = self.run_tasks({'quarter': '2027Q1', 'sprint': '5'}, FakeSearch(
                (r'issuetype = 10002', [epic_row('PLAN-1', parent='PLAN-I1', points=3, sprint=5)]),
                (r'issueKey in', [initiative_row('PLAN-I1')])))
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def test_alerts_purpose_discovers_initiatives_by_alias_labels_without_sprint_or_team(self):
        search = FakeSearch(
            (r'issuetype = 10002', [epic_row('PLAN-1', parent='PLAN-I1', sprint=5, team='t1')]),
            (r'issuetype = 10001', [initiative_row('PLAN-I1', labels=('alias',)),
                                    initiative_row('PLAN-I2', labels=('alias',))]),
            (r'issueKey in', [initiative_row('PLAN-I1')]),
        )
        response = self.run_tasks({'quarter': '2027Q1', 'sprint': '5', 'purpose': 'alerts', 'teamIds': 't1', 'teamLabels': 'alias'}, search)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        discovery = [jql for jql in search.calls if 'issuetype = 10001' in jql and 'status not in' in jql]
        self.assertTrue(discovery, search.calls)
        self.assertIn('status not in ("Done", "Killed", "Incomplete")', discovery[0])
        self.assertIn('labels = "alias"', discovery[0])
        self.assertNotIn('cf[26]', discovery[0])
        self.assertNotIn('Sprint', discovery[0])
        self.assertNotIn('cf[24]', discovery[0])  # optional Initiative Team never filters
        self.assertEqual({epic['key'] for epic in response.get_json()['epicsInScope']}, {'PLAN-I1', 'PLAN-I2'})

    def test_oversized_initiative_discovery_is_the_existing_422_partial_data_notice(self):
        def pages(payload):
            token = int(payload.get('nextPageToken') or 0)
            rows = [initiative_row(f'PLAN-{token * 100 + n + 1}') for n in range(100)]
            return jira_response(200, {'issues': rows, 'isLast': False, 'nextPageToken': str(token + 1)})

        def search(payload, *args, **kwargs):
            if 'issuetype = 10001' in payload['jql'] and 'status not in' in payload['jql']:
                return pages(payload)
            return jira_response(200, {'issues': [], 'isLast': True})
        response = self.run_tasks({'quarter': '2027Q1', 'sprint': '5', 'purpose': 'alerts', 'teamLabels': 'alias'}, search)
        self.assertEqual((response.status_code, response.get_json()['error']), (422, 'alert_scope_too_large'))

    def test_initiative_discovery_without_team_aliases_lists_no_initiatives(self):
        search = FakeSearch(
            (r'issuetype = 10002', [epic_row('PLAN-1', parent='PLAN-I1', sprint=5, team='t1')]),
            (r'issuetype = 10001', [initiative_row('PLAN-I1', labels=('alias',))]),
            (r'issueKey in', [initiative_row('PLAN-I1')]),
        )
        response = self.run_tasks({'quarter': '2027Q1', 'sprint': '5', 'purpose': 'alerts', 'teamIds': 't1'}, search)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        # No alias scopes the Department: a status-only query would list every open Initiative of the project.
        self.assertEqual([jql for jql in search.calls if 'issuetype = 10001' in jql and 'status not in' in jql], [])
        self.assertEqual(response.get_json()['epicsInScope'], [])

    def test_epic_refresh_gate_accepts_a_viewed_quarter_instead_of_a_product_tech_lane(self):
        from backend.services import epic_refresh
        args = {'purpose': 'epic-alerts', 'epicKeys': 'PLAN-1', 'sprint': '5'}
        self.assertEqual(epic_refresh.epic_keys_error(args)['error'], 'invalid_epic_refresh')
        self.assertEqual(epic_refresh.epic_keys_error({**args, 'project': 'product'}), None)
        self.assertEqual(epic_refresh.epic_keys_error({**args, 'quarter': '2027Q1'}), None)
        self.assertEqual(epic_refresh.epic_keys_error({**args, 'project': 'other'})['error'], 'invalid_epic_refresh')

    def test_compatibility_empty_list_stays_unrestricted_for_tasks_in_the_legacy_era(self):
        def unrestricted(bundle):
            legacy, delivery = bundle['configurations']
            legacy['scope']['projects'] = [{'key': 'OLD', 'type': 'product'}]
            legacy['legacyIssueTypeNames'] = []
            legacy['legacyHierarchyModes'] = {'parent': 'compatibility', 'ancestor': 'compatibility'}
        from backend.db import models
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            payload = json.loads(json.dumps(row.payload))
            unrestricted(payload['workConfigurations'])
            row.payload = payload
            session.commit()
        search = FakeSearch()
        response = self.run_tasks({'quarter': '2026Q4', 'sprint': '5'}, search)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertNotIn('type =', search.calls[0])
        self.assertNotIn('type in', search.calls[0])
        self.assertNotIn('issuetype', search.calls[0])


ALLOCATION_FIELD = 'customfield_40001'


class AllocationStampTests(WorkStructureRouteBase):
    """DELIVERY tasks carry ``projectClassification`` from Allocation (Epic, Initiative, Objective)."""

    def setUp(self):
        super().setUp()

        def mutate(bundle):
            legacy, delivery = bundle['configurations']
            legacy['scope']['projects'] = [{'key': 'OLD', 'type': 'product'}, {'key': 'OLDB', 'type': 'tech'}]
            legacy['scope']['boardId'] = '7001'
            delivery['scope']['projects'] = [{'key': 'PLAN', 'type': 'other'}]
            delivery['hierarchy'].update(planningIssueTypeId='10002', parentIssueTypeId='10001',
                                         ancestorIssueTypeId='10010')
            for name in ('sprint', 'storyPoints', 'team'):
                delivery['fields'][name] = {'fieldId': f'customfield_2{len(name)}', 'fieldName': name}
            legacy['fields']['team'] = dict(delivery['fields']['team'])
            delivery['fields']['team'] = {'fieldId': '', 'fieldName': '', 'mode': 'shared'}
            delivery['fields']['allocation'] = {'fieldId': ALLOCATION_FIELD, 'fieldName': 'Allocation'}
            delivery['allocationTypes'] = [{'value': 'Platform', 'type': 'tech'}, {'value': 'Growth', 'type': 'product'}]
        self.seed(mutate=mutate)
        self.stack.enter_context(patch.object(jira_server, 'resolve_request_catalog_sources', return_value=[Mock()]))
        self.stack.enter_context(patch.object(
            work_routes, 'admit_sprint_source', return_value=(Mock(), {'id': 5, 'name': '2027Q1'})))

    def tasks(self, params, epics, initiatives, objectives=()):
        payloads = []

        def search(payload, *args, **kwargs):
            payloads.append(payload)
            jql = payload['jql']
            rows = []
            if 'issuetype = 10002' in jql or 'type = "Story"' in jql:
                rows = epics
            elif re.search(r'issueKey in \("?PLAN-I', jql):
                rows = initiatives
            elif re.search(r'issueKey in \("?PLAN-O', jql):
                rows = list(objectives)
            return jira_response(200, {'issues': rows, 'isLast': True})
        with patch.object(jira_server, 'jira_search_request', side_effect=search):
            response = self.client.get('/api/tasks', query_string=params)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json(), payloads

    @staticmethod
    def with_allocation(row, value, objective=None):
        if value is not None:
            row['fields'][ALLOCATION_FIELD] = {'value': value, 'id': '1'}
        if objective:
            row['fields']['parent'] = {'key': objective, 'fields': {'issuetype': {'id': '10010', 'name': 'Objective'}}}
        return row

    def test_stamp_follows_epic_then_initiative_then_one_objective_batch(self):
        epics = [self.with_allocation(epic_row('PLAN-1', parent='PLAN-I1', sprint=5), 'Platform'),
                 epic_row('PLAN-2', parent='PLAN-I1', sprint=5),
                 epic_row('PLAN-3', parent='PLAN-I2', sprint=5),
                 epic_row('PLAN-4', parent='PLAN-I3', sprint=5)]
        initiatives = [self.with_allocation(initiative_row('PLAN-I1'), None, 'PLAN-O1'),
                       self.with_allocation(initiative_row('PLAN-I2'), 'Growth', 'PLAN-O1'),
                       self.with_allocation(initiative_row('PLAN-I3'), 'Unmapped')]
        objectives = [self.with_allocation({'key': 'PLAN-O1', 'fields': {}}, 'Platform')]
        body, payloads = self.tasks({'quarter': '2027Q1', 'sprint': '5'}, epics, initiatives, objectives)
        self.assertEqual({issue['key']: issue['fields']['projectClassification'] for issue in body['issues']},
                         {'PLAN-1': 'tech', 'PLAN-2': 'tech', 'PLAN-3': 'product', 'PLAN-4': 'product'})
        main = [p for p in payloads if 'issuetype = 10002' in p['jql']]
        self.assertEqual(len(main), 1)
        self.assertIn(ALLOCATION_FIELD, main[0]['fields'])
        initiative_batches = [p for p in payloads if re.search(r'issueKey in \("?PLAN-I', p['jql'])]
        self.assertTrue(all(ALLOCATION_FIELD in p['fields'] for p in initiative_batches))
        objective_batches = [p for p in payloads if re.search(r'issueKey in \("?PLAN-O', p['jql'])]
        self.assertEqual(len(objective_batches), 1)
        self.assertEqual(objective_batches[0]['fields'], [ALLOCATION_FIELD])

    def test_no_objective_batch_when_every_initiative_is_set(self):
        epics = [epic_row('PLAN-1', parent='PLAN-I1', sprint=5)]
        initiatives = [self.with_allocation(initiative_row('PLAN-I1'), 'Platform', 'PLAN-O1')]
        body, payloads = self.tasks({'quarter': '2027Q1', 'sprint': '5'}, epics, initiatives)
        self.assertEqual(body['issues'][0]['fields']['projectClassification'], 'tech')
        self.assertEqual([p for p in payloads if 'PLAN-O' in p['jql']], [])

    def test_alerts_request_reads_no_allocation(self):
        """The alerts load keeps only outcomes, so it must not repeat the Allocation read or Objective batch."""
        epics = [epic_row('PLAN-1', parent='PLAN-I1', sprint=5)]
        initiatives = [self.with_allocation(initiative_row('PLAN-I1'), None, 'PLAN-O1')]
        objectives = [self.with_allocation({'key': 'PLAN-O1', 'fields': {}}, 'Platform')]
        _body, payloads = self.tasks({'quarter': '2027Q1', 'sprint': '5', 'purpose': 'alerts'},
                                     epics, initiatives, objectives)
        self.assertEqual([p for p in payloads if 'PLAN-O' in p['jql']], [])
        main = [p for p in payloads if 'issuetype = 10002' in p['jql']]
        self.assertTrue(main)
        self.assertTrue(all(ALLOCATION_FIELD not in (p.get('fields') or []) for p in main))

    def test_failed_objective_batch_is_product(self):
        epics = [epic_row('PLAN-1', parent='PLAN-I1', sprint=5)]
        initiatives = [self.with_allocation(initiative_row('PLAN-I1'), None, 'PLAN-O1')]

        def search(payload, *args, **kwargs):
            if 'PLAN-O1' in payload['jql']:
                return jira_response(500, {})
            rows = epics if 'issuetype = 10002' in payload['jql'] else initiatives if 'PLAN-I1' in payload['jql'] else []
            return jira_response(200, {'issues': rows, 'isLast': True})
        with patch.object(jira_server, 'jira_search_request', side_effect=search):
            body = self.client.get('/api/tasks', query_string={'quarter': '2027Q1', 'sprint': '5'}).get_json()
        self.assertEqual(body['issues'][0]['fields']['projectClassification'], 'product')

    def test_legacy_request_has_no_allocation_field_or_stamp(self):
        story = epic_row('OLD-1', sprint=5)
        story['fields']['project'] = {'key': 'OLDB', 'name': 'Old B'}
        body, payloads = self.tasks({'quarter': '2026Q4', 'sprint': '5'}, [story], [])
        self.assertEqual([issue['key'] for issue in body['issues']], ['OLD-1'])
        self.assertFalse(any(ALLOCATION_FIELD in (p.get('fields') or []) for p in payloads))
        self.assertFalse(any('projectClassification' in issue['fields'] for issue in body['issues']))


class PromotedMissingInfoTests(WorkStructureRouteBase):
    def setUp(self):
        super().setUp()
        self.promoted_seed()
        self.stack.enter_context(patch.object(jira_server, 'resolve_request_catalog_sources', return_value=[Mock()]))
        self.stack.enter_context(patch.object(
            work_routes, 'admit_sprint_source', return_value=(Mock(), {'id': 5, 'name': '2027Q1'})))

    def test_missing_epic_fields_and_null_points_through_initiatives(self):
        search = FakeSearch(
            (r'cf\[26\] = 5', [epic_row('PLAN-1', parent='PLAN-I1', points=8, team='t1', sprint=5)]),
            (r'^key in', [initiative_row('PLAN-I1')]),
            (r'parent in \("PLAN-I1"\)', [
                epic_row('PLAN-1', parent='PLAN-I1', points=8, team='t1', sprint=5),
                epic_row('PLAN-2', parent='PLAN-I1', points=None, team=None, sprint=None)]),
        )
        with patch.object(jira_server, 'jira_search_request', side_effect=search):
            response = self.client.get('/api/missing-info?quarter=2027Q1&sprint=5')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual([issue['key'] for issue in body['issues']], ['PLAN-2'])
        self.assertEqual(body['issues'][0]['fields']['missingFields'], ['Sprint', 'Story Points', 'Team'])
        self.assertIsNone(body['issues'][0]['fields']['customfield_10004'])
        self.assertEqual([epic['key'] for epic in body['epics']], ['PLAN-I1'])
        self.assertNotIn('complete', body)

    def test_failed_child_page_is_incomplete_never_a_clean_scan(self):
        def fail_children(payload):
            return jira_response(500, None)
        search = FakeSearch((r'cf\[26\] = 5', [epic_row('PLAN-1', parent='PLAN-I1', sprint=5)]),
                            (r'^key in', [initiative_row('PLAN-I1')]))
        original = search.__call__

        def mixed(payload, *args, **kwargs):
            if 'parent in ("PLAN-I1")' in payload['jql']:
                return jira_response(500, None)
            return original(payload, *args, **kwargs)
        with patch.object(jira_server, 'jira_search_request', side_effect=mixed):
            response = self.client.get('/api/missing-info?quarter=2027Q1&sprint=5')
        self.assertEqual(response.status_code, 200)
        self.assertIs(response.get_json()['complete'], False)

    def test_backlog_panel_is_retired_without_requests(self):
        search = FakeSearch()
        with patch.object(jira_server, 'jira_search_request', side_effect=search):
            response = self.client.get('/api/backlog-epics?quarter=2027Q1')
        self.assertEqual((response.status_code, response.get_json()), (200, {'epics': []}))
        self.assertEqual(search.calls, [])


class WorkerContextTests(WorkStructureRouteBase):
    def test_roles_resolve_without_a_request_context_and_reach_the_real_search_wrapper(self):
        """No Flask request: a captured context drives the real ``jira_search_request`` auth wrapper."""
        self.promoted_seed()
        from backend.services import planning_work
        with self.factory() as session:
            from backend.db import models
            payload = session.query(models.WorkspaceDashboardConfig).one().payload
        snapshot = type('Snapshot', (), {'payload': payload})()
        context = ws.resolve_work_configuration(snapshot, quarter='2027Q1', flag_enabled=True)
        auth = Mock()
        wrapper_calls = []

        def real_wrapper_stub(payload, *args, **kwargs):
            wrapper_calls.append(payload['jql'])
            return jira_response(200, {'issues': [], 'isLast': True})

        # The worker goes through jira_server.jira_search_request itself (not a route mock).
        with patch.object(jira_server, 'current_jira_search', side_effect=real_wrapper_stub) as search:
            def transport(request_payload):
                response = jira_server.jira_search_request(request_payload, context=auth)
                return response.json()
            work = planning_work.load_planning_work(context, auth, '2027Q1', (), 'tasks', transport)
        self.assertTrue(work.complete)
        self.assertEqual(len(wrapper_calls), 1)
        self.assertIn('issuetype = 10002', wrapper_calls[0])
        search.assert_called()


if __name__ == '__main__':
    unittest.main()


# --- Component Board (new model: Components belong to Epic leaves) -------------------------------

from types import SimpleNamespace  # noqa: E402

from backend.routes import eng_board_routes  # noqa: E402
from backend.services import planning_work  # noqa: E402
from backend.services.eng_board_stream import EngBoardRequestTransport  # noqa: E402
from tests.test_eng_board_routes import FakeResponse, board_snapshot, db_context  # noqa: E402
from tests.test_planning_work_profiles import bundle as profile_bundle, context as profile_context  # noqa: E402


def leaf(key, parent, points, components, team=None):
    return {'key': key, 'fields': {
        'summary': f'{key} summary', 'status': {'id': '3', 'name': 'In Progress'}, 'priority': None,
        'issuetype': {'id': '10002', 'name': 'Epic'}, 'assignee': None, 'updated': None,
        'parent': {'key': parent}, 'project': {'id': '1', 'key': 'PLAN', 'name': 'PLAN'},
        'customfield_10004': points, 'customfield_30101': {'id': team, 'name': team} if team else None,
        'customfield_10101': [], 'customfield_35024': None, 'components': [{'name': c} for c in components]}}


def parent_shell(key, status='To Do'):
    return {'key': key, 'fields': {
        'summary': f'{key} summary', 'status': {'id': '1', 'name': status}, 'priority': None,
        'assignee': None, 'updated': None, 'parent': None, 'project': {'id': '1', 'key': 'PLAN', 'name': 'PLAN'},
        'customfield_35024': None}}


class ComponentBoardStreamTests(unittest.TestCase):
    """Paired fixture: Initiative I has Epic A (8 SP, Component A) and Epic B (5 SP, Component B)."""

    LEAVES = {'PLAN-E1': leaf('PLAN-E1', 'PLAN-I1', 8, ('Component A',)),
              'PLAN-E2': leaf('PLAN-E2', 'PLAN-I1', 5, ('Component B',)),
              'PLAN-E3': leaf('PLAN-E3', 'PLAN-I1', 2, (), team='team-a')}

    def snapshot(self, components, teams=(), scope='component', mutate=None):
        roles = planning_work.WorkRoles(profile_context('2027Q1', profile_bundle(mutate)))
        return board_snapshot(
            query=eng_board_routes.BoardQuery('department-a', scope, None, 'todo', False),
            components=components, teams=teams, projects=(('PLAN', 'other'),),
            issue_type_ids=('10002',), epic_link_field_id=None,
            work_request=SimpleNamespace(roles=roles, context=roles.context),
            parent_clause=roles.parent_clause())

    def stream(self, snapshot, initiatives=None, plain=None, fail_leaf_discovery=False):
        calls = []
        initiatives = {'PLAN-I1': parent_shell('PLAN-I1')} if initiatives is None else initiatives
        plain = initiatives if plain is None else plain

        def search(payload, **kwargs):
            jql = payload['jql']
            calls.append(jql)
            keys = re.findall(r'"(PLAN-[A-Z0-9]+)"', jql)
            if 'issuetype in ("10002")' in jql and 'component in' in jql:
                if fail_leaf_discovery:
                    return FakeResponse({}, 500)
                names = set(re.findall(r'"(Component [A-Z])"', jql))
                rows = [row for row in self.LEAVES.values()
                        if names & {c['name'] for c in row['fields']['components']}]
            elif 'issuetype in ("10002")' in jql and 'cf[30101]' in jql:
                rows = [row for row in self.LEAVES.values() if row['fields']['customfield_30101']]
            elif 'issuetype in ("10002")' in jql and 'key in' in jql:
                rows = [self.LEAVES[key] for key in keys if key in self.LEAVES]
            elif 'issuetype = 10001' in jql:
                rows = [initiatives[key] for key in keys if key in initiatives]
            else:  # plain parent read used to tell "excluded by rule" from "unreadable"
                rows = [plain[key] for key in keys if key in plain]
            return FakeResponse({'issues': rows, 'isLast': True})

        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
            frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                SimpleNamespace(current_jira_search=search), snapshot, EngBoardRequestTransport())]
        return frames, calls

    @staticmethod
    def children(frames):
        return sorted(child['key'] for frame in frames if frame['type'] == 'column'
                      for child in frame['children'])

    @staticmethod
    def points(frames):
        return sum(child['storyPoints'] or 0 for frame in frames if frame['type'] == 'column'
                   for child in frame['children'])

    def test_a_only_shows_the_initiative_once_with_only_the_matching_epic(self):
        frames, calls = self.stream(self.snapshot(('Component A',)))
        self.assertEqual('success', frames[-1].get('outcome'), frames)
        self.assertEqual(1, frames[-1]['epicCount'])
        self.assertEqual(['PLAN-E1'], self.children(frames))
        self.assertEqual(8, self.points(frames))
        self.assertFalse(any('PLAN-E2' in jql for jql in calls))        # the sibling is never fetched
        self.assertFalse(any('parent in' in jql for jql in calls))      # no blind parent->children query
        authoritative = [f for f in frames if f['type'] == 'index' and f.get('membership') == 'authoritative']
        self.assertEqual([['PLAN-I1']], [[e['key'] for e in f['epics']] for f in authoritative])

    def test_delivery_children_carry_the_allocation_classification(self):
        field = 'customfield_40001'

        def mapped(bundle):
            bundle['configurations'][1]['allocationTypes'] = [{'value': 'Platform', 'type': 'tech'}]
        leaves = {key: json.loads(json.dumps(row)) for key, row in self.LEAVES.items()}
        leaves['PLAN-E1']['fields'][field] = {'value': 'Platform'}
        leaves['PLAN-E2']['fields'][field] = {'value': 'Growth'}
        fields_seen = []
        original = eng_board_routes._search_page

        def spy(server, snapshot, transport, payload, timeout):
            fields_seen.append(list(payload.get('fields') or []))
            return original(server, snapshot, transport, payload, timeout)
        with patch.object(self, 'LEAVES', leaves), patch.object(eng_board_routes, '_search_page', side_effect=spy):
            frames, _calls = self.stream(self.snapshot(('Component A', 'Component B'), mutate=mapped))
        self.assertEqual('success', frames[-1].get('outcome'), frames)
        classes = {child['key']: child['projectClassification'] for frame in frames if frame['type'] == 'column'
                   for child in frame['children']}
        self.assertEqual({'PLAN-E1': 'tech', 'PLAN-E2': 'product'}, classes)
        self.assertEqual([False, True, True], [field in fields for fields in fields_seen])  # leaf discovery, Initiatives, children

    def test_delivery_board_reads_the_objective_only_for_blank_initiatives_in_batches_of_40(self):
        field = 'customfield_40001'

        def mapped(bundle):
            bundle['configurations'][1]['allocationTypes'] = [{'value': 'Platform', 'type': 'tech'}]
        objective_type = {'id': '10010', 'name': 'Objective'}

        def initiative(key, objective=None, allocation=None, parent_type=objective_type):
            row = parent_shell(key)
            if objective:
                row['fields']['parent'] = {'key': objective, 'fields': {'issuetype': parent_type}}
            row['fields'][field] = {'value': allocation} if allocation else None
            return row
        objective_reads = []

        def run(initiatives, objectives):
            leaves = {key: json.loads(json.dumps(row)) for key, row in self.LEAVES.items()}
            for index, key in enumerate(sorted(initiatives)):
                leaves[f'PLAN-E{index + 10}'] = leaf(f'PLAN-E{index + 10}', key, 1, ('Component A',))
            original = eng_board_routes._search_page
            objective_reads.clear()

            def spy(server, snapshot, transport, payload, timeout):
                if payload.get('fields') == [field]:
                    keys = re.findall(r'PLAN-O\d+', payload['jql'])
                    objective_reads.append(keys)
                    return {'issues': [{'key': key, 'fields': {field: objectives.get(key)}} for key in keys],
                            'isLast': True}
                return original(server, snapshot, transport, payload, timeout)
            with patch.object(self, 'LEAVES', leaves), \
                    patch.object(eng_board_routes, '_search_page', side_effect=spy):
                frames, _calls = self.stream(self.snapshot(('Component A',), mutate=mapped),
                                             initiatives=initiatives)
            self.assertEqual('success', frames[-1].get('outcome'), frames)
            return {child['key']: child['projectClassification'] for frame in frames if frame['type'] == 'column'
                    for child in frame['children']}

        # Every Initiative carries a value: no Objective read at all.
        valued = {'PLAN-I1': initiative('PLAN-I1', 'PLAN-O1', 'Growth')}
        self.assertEqual({'PLAN-E1': 'product', 'PLAN-E10': 'product'}, run(valued, {}))
        self.assertEqual([], objective_reads)
        # A blank Initiative under a Tech Objective: its blank Epics are Tech, the valued Epic keeps its own.
        blank = {'PLAN-I1': initiative('PLAN-I1', 'PLAN-O1')}
        classes = run(blank, {'PLAN-O1': {'value': 'Platform'}})
        self.assertEqual({'PLAN-E1': 'tech', 'PLAN-E10': 'tech'}, classes)
        self.assertEqual([['PLAN-O1']], objective_reads)
        # 41 distinct Objectives cost exactly two reads; an untyped parent is not an Objective and is never read.
        many = {f'PLAN-I{n}': initiative(f'PLAN-I{n}', f'PLAN-O{n}') for n in range(1, 42)}
        many['PLAN-I99'] = initiative('PLAN-I99', 'PLAN-O99', parent_type={'id': '10001', 'name': 'Initiative'})
        classes = run(many, {f'PLAN-O{n}': {'value': 'Platform'} for n in range(1, 42)})
        self.assertEqual([40, 1], [len(keys) for keys in objective_reads])
        self.assertNotIn('PLAN-O99', [key for keys in objective_reads for key in keys])
        self.assertEqual('product', classes[f'PLAN-E{len(many) + 9}'], 'PLAN-I99 sorts last: untyped parent')
        self.assertEqual({'tech'}, {classes[f'PLAN-E{n}'] for n in range(10, 51)})

    def test_a_plus_b_shows_both_epics_under_one_initiative(self):
        frames, _calls = self.stream(self.snapshot(('Component A', 'Component B')))
        self.assertEqual(1, frames[-1]['epicCount'])
        self.assertEqual(['PLAN-E1', 'PLAN-E2'], self.children(frames))
        self.assertEqual(13, self.points(frames))

    def test_all_work_with_components_and_teams_unions_team_leaves_without_siblings(self):
        frames, calls = self.stream(self.snapshot(('Component A',), teams=('team-a',), scope='all_work'))
        self.assertEqual('success', frames[-1].get('outcome'), frames)
        self.assertEqual(1, frames[-1]['epicCount'])
        self.assertEqual(['PLAN-E1', 'PLAN-E3'], self.children(frames))
        self.assertNotIn('PLAN-E2', ' '.join(calls))
        # Team filtering is on the Epic leaves via the mapped Team field, never on the Initiative.
        self.assertTrue(any('cf[30101]' in jql and 'issuetype in ("10002")' in jql for jql in calls))
        self.assertFalse(any('cf[30101]' in jql and 'issuetype = 10001' in jql for jql in calls))

    def test_initiatives_own_components_never_admit_it(self):
        frames, calls = self.stream(self.snapshot(('Component C',)))
        self.assertEqual('success', frames[-1].get('outcome'), frames)
        self.assertEqual(0, frames[-1]['epicCount'])
        self.assertFalse(any('issuetype = 10001' in jql and 'component' in jql for jql in calls))

    def test_inaccessible_parent_keeps_the_readable_leaf_under_a_key_only_shell(self):
        frames, _calls = self.stream(self.snapshot(('Component A',)), initiatives={}, plain={})
        self.assertEqual('success', frames[-1].get('outcome'), frames)
        self.assertEqual(['PLAN-E1'], self.children(frames))
        shells = [e for f in frames if f['type'] == 'column' for e in f['epics']]
        self.assertEqual(['PLAN-I1'], [e['key'] for e in shells])
        self.assertEqual('PLAN-I1', shells[0]['summary'])  # key only: no Jira metadata exposed

    def test_parent_excluded_by_the_terminal_rule_drops_its_leaves(self):
        readable = {'PLAN-I1': parent_shell('PLAN-I1', status='Done')}
        frames, calls = self.stream(self.snapshot(('Component A',)), initiatives={}, plain=readable)
        self.assertEqual(0, frames[-1]['epicCount'])
        self.assertEqual([], self.children(frames))
        self.assertFalse(any('key in ("PLAN-E1")' in jql for jql in calls))

    def test_incomplete_component_discovery_is_a_terminal_error_never_empty_or_ready(self):
        frames, _calls = self.stream(self.snapshot(('Component A',)), fail_leaf_discovery=True)
        self.assertEqual('error', frames[-1]['type'])
        self.assertFalse(any(f['type'] == 'index' and f.get('membership') == 'authoritative' for f in frames))
        self.assertFalse(any(f['type'] == 'column' for f in frames))

    def test_cohort_signature_follows_membership(self):
        a, ab = eng_board.LeafCohort(), eng_board.LeafCohort()
        a.add_leaf('PLAN-E1', 'PLAN-I1')
        ab.add_leaf('PLAN-E1', 'PLAN-I1')
        ab.add_leaf('PLAN-E2', 'PLAN-I1')
        self.assertNotEqual(a.signature(), ab.signature())
        self.assertEqual(['PLAN-E1'], a.leaf_keys_for(['plan-i1']))

    def test_legacy_component_discovery_is_unchanged(self):
        calls = []

        def search(payload, **kwargs):
            calls.append(payload['jql'])
            return FakeResponse({'issues': [], 'isLast': True})
        with patch.object(eng_board_routes, '_assert_current', return_value=db_context()):
            frames = [json.loads(line) for line in eng_board_routes._frame_stream(
                SimpleNamespace(current_jira_search=search), board_snapshot(), EngBoardRequestTransport())]
        self.assertEqual('success', frames[-1].get('outcome'), frames)
        self.assertEqual(1, len(calls))
        self.assertIn('issuetype = Epic AND component in ("Component A")', calls[0])


class BoardSelectorTests(unittest.TestCase):
    def setUp(self):
        jira_server.app.config['TESTING'] = True
        jira_server.app.secret_key = 'test-secret'
        self.client = jira_server.app.test_client()

    def test_selector_failures_pass_through_with_their_exact_code(self):
        response = (jira_server.app.response_class(
            json.dumps({'error': 'configuration_required'}), 409, mimetype='application/json'))
        from tests.oauth_test_helpers import install_oauth_session
        install_oauth_session(self.client)
        with patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                patch.object(eng_board_routes, 'database_storage_enabled', return_value=True), \
                patch.object(eng_board_routes, '_capture_snapshot',
                             side_effect=eng_board_routes.BoardWorkSelectorError(response)):
            result = self.client.get('/api/eng/board', query_string={
                'departmentId': 'd', 'scope': 'component', 'quarter': '2027Q1'})
        self.assertEqual((result.status_code, result.get_json()['error']), (409, 'configuration_required'))

    def test_selector_keys_are_accepted_by_the_query_parser(self):
        from werkzeug.datastructures import MultiDict
        query = eng_board_routes._parse_query(MultiDict([
            ('departmentId', 'd'), ('scope', 'all_work'), ('quarter', '2027Q1'),
            ('configurationId', 'delivery'), ('configurationRevision', '1')]))
        self.assertEqual(query.scope, 'all_work')
        with self.assertRaises(eng_board_routes.BoardRouteError):
            eng_board_routes._parse_query(MultiDict([('departmentId', 'd'), ('scope', 'all_work'), ('bogus', '1')]))
