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
from tests.oauth_test_helpers import set_up_db_oauth

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


def seed_department(test, allocation_types=(), team_ids=('t1',), group_id='dept'):
    from backend.db import models
    with test.factory() as session:
        row = session.query(models.WorkspaceGroupConfig).filter_by(workspace_id=test.workspace_id).one_or_none()
        payload = {'version': 2, 'groups': [{'id': group_id, 'name': f'Department {group_id}', 'teamIds': list(team_ids),
                    'allocationTypes': list(allocation_types)}], 'defaultGroupId': 'dept'}
        if row is None:
            session.add(models.WorkspaceGroupConfig(workspace_id=test.workspace_id, payload_version=2,
                                                     config_revision=1, payload=payload))
        else:
            payload['groups'] = [group for group in row.payload.get('groups', []) if group['id'] != group_id] + payload['groups']
            row.payload = payload
            row.config_revision += 1
        session.commit()


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
        seed_department(self)
        self.stack.enter_context(patch.object(jira_server, 'current_jira_get', return_value=jira_response(200, {})))
        self.sources = self.stack.enter_context(patch.object(
            jira_server, 'resolve_request_catalog_sources', return_value=[Mock()]))
        self.stack.enter_context(patch.object(
            work_routes, 'admit_sprint_source', return_value=(Mock(), {'id': 5, 'name': '2027Q1'})))

    def run_tasks(self, params, search):
        with patch.object(jira_server, 'jira_search_request', side_effect=search):
            return self.client.get('/api/tasks', query_string={'groupId': 'dept', **params})

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
    """DELIVERY tasks carry ``projectClassification``: their Initiative's Allocation class, nothing else."""

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
        seed_department(self, [{'value': 'Platform', 'type': 'tech'}, {'value': 'Growth', 'type': 'product'}])
        self.stack.enter_context(patch.object(jira_server, 'current_jira_get', return_value=jira_response(200, {})))
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
            response = self.client.get('/api/tasks', query_string={'groupId': 'dept', **params})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json(), payloads

    @staticmethod
    def with_allocation(row, value, objective=None):
        if value is not None:
            row['fields'][ALLOCATION_FIELD] = {'value': value, 'id': '1'}
        if objective:
            row['fields']['parent'] = {'key': objective, 'fields': {'issuetype': {'id': '10010', 'name': 'Objective'}}}
        return row

    def test_saved_department_mapping_partitions_same_teams_and_tasks_cache(self):
        rows = [epic_row('PLAN-1', parent='PLAN-I1', sprint=5)]
        parents = [self.with_allocation(initiative_row('PLAN-I1'), 'Platform')]
        first, _ = self.tasks({'quarter': '2027Q1', 'sprint': '5'}, rows, parents)
        seed_department(self, [{'value': 'Platform', 'type': 'product'}], group_id='second')
        second, _ = self.tasks({'quarter': '2027Q1', 'sprint': '5', 'groupId': 'second'}, rows, parents)
        self.assertEqual(first['issues'][0]['fields']['projectClassification'], 'tech')
        self.assertEqual(second['issues'][0]['fields']['projectClassification'], 'product')
        seed_department(self)
        empty, _ = self.tasks({'quarter': '2027Q1', 'sprint': '5'}, rows, parents)
        self.assertEqual(empty['issues'][0]['fields']['projectClassification'], 'none')

    def test_invalid_or_teamless_department_fails_before_jira(self):
        fake = FakeSearch()
        with patch.object(jira_server, 'jira_search_request', side_effect=fake):
            for group_id, code, status in ((None, 'department_required', 400), ('unknown', 'department_not_found', 404)):
                params = {'quarter': '2027Q1', 'sprint': '5'}
                if group_id is not None:
                    params['groupId'] = group_id
                response = self.client.get('/api/tasks', query_string=params)
                self.assertEqual((response.status_code, response.get_json()['error']), (status, code))
            seed_department(self, team_ids=())
            response = self.client.get('/api/tasks', query_string={'quarter': '2027Q1', 'sprint': '5', 'groupId': 'dept'})
        self.assertEqual((response.status_code, response.get_json()['error']), (400, 'department_teams_required'))
        with patch.object(jira_server, 'load_request_effective_groups', side_effect=jira_server.ConfigStorageError('private storage details')):
            response = self.client.get('/api/tasks', query_string={'quarter': '2027Q1', 'sprint': '5', 'groupId': 'dept'})
        self.assertEqual((response.status_code, response.get_json()), (503, {
            'error': 'config_storage_unavailable', 'message': 'Configuration storage is temporarily unavailable.'}))
        self.assertEqual(fake.calls, [])

    def test_stamp_is_the_initiatives_class_and_no_objective_batch(self):
        epics = [self.with_allocation(epic_row('PLAN-1', parent='PLAN-I1', sprint=5), 'Platform'),
                 epic_row('PLAN-2', parent='PLAN-I1', sprint=5),
                 self.with_allocation(epic_row('PLAN-3', parent='PLAN-I2', sprint=5), 'Platform'),
                 epic_row('PLAN-4', parent='PLAN-I3', sprint=5),
                 epic_row('PLAN-5', parent='PLAN-I4', sprint=5),
                 self.with_allocation(epic_row('PLAN-6', sprint=5), 'Platform')]
        initiatives = [self.with_allocation(initiative_row('PLAN-I1'), None, 'PLAN-O1'),
                       self.with_allocation(initiative_row('PLAN-I2'), 'Growth', 'PLAN-O1'),
                       self.with_allocation(initiative_row('PLAN-I3'), 'Unmapped'),
                       self.with_allocation(initiative_row('PLAN-I4'), 'Platform')]
        objectives = [self.with_allocation({'key': 'PLAN-O1', 'fields': {}}, 'Platform')]
        body, payloads = self.tasks({'quarter': '2027Q1', 'sprint': '5'}, epics, initiatives, objectives)
        self.assertEqual({issue['key']: issue['fields']['projectClassification'] for issue in body['issues']},
                         {'PLAN-1': 'none', 'PLAN-2': 'none', 'PLAN-3': 'product', 'PLAN-4': 'none',
                          'PLAN-5': 'tech', 'PLAN-6': 'none'})
        self.assertEqual({key: body['epics'][key]['allocationClass'] for key in ('PLAN-I1', 'PLAN-I2', 'PLAN-I3', 'PLAN-I4')},
                         {'PLAN-I1': 'none', 'PLAN-I2': 'product', 'PLAN-I3': 'none', 'PLAN-I4': 'tech'})
        main = [p for p in payloads if 'issuetype = 10002' in p['jql']]
        self.assertEqual(len(main), 1)
        self.assertNotIn(ALLOCATION_FIELD, main[0]['fields'])
        initiative_batches = [p for p in payloads if re.search(r'issueKey in \("?PLAN-I', p['jql'])]
        self.assertTrue(initiative_batches)
        self.assertTrue(all(ALLOCATION_FIELD in p['fields'] for p in initiative_batches))
        self.assertEqual([p for p in payloads if 'PLAN-O' in p['jql']], [])

    def test_unreadable_initiative_is_none(self):
        epics = [epic_row('PLAN-1', parent='PLAN-I1', sprint=5)]

        def search(payload, *args, **kwargs):
            if 'PLAN-I1' in payload['jql']:
                return jira_response(500, {})
            rows = epics if 'issuetype = 10002' in payload['jql'] else []
            return jira_response(200, {'issues': rows, 'isLast': True})
        with patch.object(jira_server, 'jira_search_request', side_effect=search):
            response = self.client.get('/api/tasks', query_string={'quarter': '2027Q1', 'sprint': '5', 'groupId': 'dept'})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body['issues'][0]['fields']['projectClassification'], 'none')
        self.assertNotIn('PLAN-I1', body['epics'])

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
from backend.services import allocation_classification, planning_work  # noqa: E402
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
    """DELIVERY Allocation scope admits matching Initiatives and eligible leaves."""

    def setUp(self):
        set_up_db_oauth(self)

    LEAVES = {'PLAN-E1': leaf('PLAN-E1', 'PLAN-I1', 8, ()),
              'PLAN-E2': leaf('PLAN-E2', 'PLAN-I1', 5, ('Unrelated',)),
              'PLAN-E3': leaf('PLAN-E3', 'PLAN-I2', 2, (), team='team-a'),
              'PLAN-E4': leaf('PLAN-E4', 'PLAN-I2', 3, ('Platform',))}

    def snapshot(self, components, teams=(), scope='allocation', mutate=None, allocation_types=()):
        roles = planning_work.WorkRoles(profile_context('2027Q1', profile_bundle(mutate)))
        return board_snapshot(
            query=eng_board_routes.BoardQuery('department-a', scope, 42 if scope == 'sprint' else None, 'todo', False),
            components=components, teams=teams, projects=(('PLAN', 'other'),),
            group={'id': 'department-a', 'allocationTypes': list(allocation_types)},
            issue_type_ids=('10002',), epic_link_field_id=None,
            work_request=SimpleNamespace(roles=roles, context=roles.context),
            parent_clause=roles.parent_clause())

    def stream(self, snapshot, initiatives=None, plain=None, fail_discovery=False):
        calls = []
        if initiatives is None:
            initiatives = {key: parent_shell(key) for key in ('PLAN-I1', 'PLAN-I2')}
            initiatives['PLAN-I1']['fields']['customfield_40001'] = {'value': 'Platform'}
            initiatives['PLAN-I2']['fields']['customfield_40001'] = {'value': 'Growth'}
        plain = initiatives if plain is None else plain

        def search(payload, **kwargs):
            jql = payload['jql']
            calls.append(payload)
            keys = re.findall(r'"(PLAN-[A-Z0-9]+)"', jql)
            if 'issuetype = 10001' in jql and 'cf[40001]' in jql:
                if fail_discovery:
                    return FakeResponse({}, 500)
                values = re.findall(r'cf\[40001\] in \((.*?)\)', jql)[0]
                wanted = re.findall(r'"([^"\\]*(?:\\.[^"\\]*)*)"', values)
                rows = [row for row in initiatives.values()
                        if allocation_classification.allocation_value(row['fields'].get('customfield_40001')) in wanted]
            elif 'issuetype = 10001' in jql:
                rows = [initiatives[key] for key in keys if key in initiatives] if keys else list(initiatives.values())
            elif 'issuetype in ("10002")' in jql and 'cf[30101]' in jql:
                rows = [row for row in self.LEAVES.values() if row['fields']['customfield_30101']]
            elif 'issuetype in ("10002")' in jql and 'parent in' in jql:
                rows = [row for row in self.LEAVES.values() if row['fields']['parent']['key'] in keys]
            elif 'issuetype in ("10002")' in jql and 'key in' in jql:
                rows = [self.LEAVES[key] for key in keys if key in self.LEAVES]
            else:
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

    def test_sprint_membership_uses_teams_not_allocation_or_legacy_components(self):
        frames, calls = self.stream(self.snapshot(('Platform',), teams=('team-a',), scope='sprint'))
        self.assertEqual(frames[-1].get('outcome'), 'success', frames)
        self.assertFalse(any('cf[40001]' in row['jql'] or 'component in' in row['jql'] for row in calls))
        child_queries = [row['jql'] for row in calls if 'issuetype in ("10002")' in row['jql']]
        self.assertTrue(child_queries)
        self.assertTrue(all('cf[10101] = 42' in jql and 'cf[30101] in ("team-a")' in jql
                            for jql in child_queries), child_queries)

    def test_empty_map_all_work_admits_only_team_leaves_without_allocation_field(self):
        def missing(bundle):
            bundle['configurations'][1]['fields']['allocation'] = {'fieldId': '', 'fieldName': ''}
        frames, calls = self.stream(self.snapshot((), teams=('team-a',), scope='all_work', mutate=missing))
        self.assertEqual('success', frames[-1].get('outcome'), frames)
        self.assertEqual(['PLAN-E3'], self.children(frames))
        self.assertFalse(any('cf[40001]' in row['jql'] for row in calls))

    def test_allocation_scope_admits_all_eligible_children_without_any_component_match(self):
        frames, calls = self.stream(self.snapshot(('Platform',)))
        self.assertEqual('success', frames[-1].get('outcome'), frames)
        self.assertEqual(1, frames[-1]['epicCount'])
        self.assertEqual(['PLAN-E1', 'PLAN-E2'], self.children(frames))
        self.assertEqual(13, self.points(frames))
        self.assertFalse(any('component' in p['jql'] for p in calls))
        self.assertFalse(any('PLAN-E4' in p['jql'] for p in calls))
        authoritative = [f for f in frames if f['type'] == 'index' and f.get('membership') == 'authoritative']
        self.assertEqual([['PLAN-I1']], [[e['key'] for e in f['epics']] for f in authoritative])

    def test_matching_raw_values_do_not_depend_on_product_tech_mapping(self):
        frames, _calls = self.stream(self.snapshot(('Platform', 'Growth')))
        self.assertEqual(2, frames[-1]['epicCount'])
        self.assertEqual(['PLAN-E1', 'PLAN-E2', 'PLAN-E3', 'PLAN-E4'], self.children(frames))

    def test_mismatching_or_missing_parent_allocation_never_admits_component_matching_children(self):
        for allocation in (None, {'value': 'Growth'}):
            with self.subTest(allocation=allocation):
                parent = parent_shell('PLAN-I2')
                parent['fields']['customfield_40001'] = allocation
                frames, calls = self.stream(self.snapshot(('Platform',)), initiatives={'PLAN-I2': parent})
                self.assertEqual('success', frames[-1].get('outcome'), frames)
                self.assertEqual(0, frames[-1]['epicCount'])
                self.assertEqual([], self.children(frames))
                self.assertFalse(any('issuetype in ("10002")' in p['jql'] for p in calls))

    def test_all_work_unions_only_team_leaves_from_nonmatching_initiatives(self):
        frames, calls = self.stream(self.snapshot(('Platform',), teams=('team-a',), scope='all_work'))
        self.assertEqual('success', frames[-1].get('outcome'), frames)
        self.assertEqual(2, frames[-1]['epicCount'])
        self.assertEqual(['PLAN-E1', 'PLAN-E2', 'PLAN-E3'], self.children(frames))
        self.assertEqual(15, self.points(frames))
        self.assertFalse(any('PLAN-E4' in p['jql'] for p in calls))
        self.assertTrue(any('cf[30101]' in p['jql'] and 'issuetype in ("10002")' in p['jql'] for p in calls))
        self.assertFalse(any('cf[30101]' in p['jql'] and 'issuetype = 10001' in p['jql'] for p in calls))

    def test_unreadable_team_parent_keeps_only_its_readable_team_leaf_under_key_shell(self):
        frames, _calls = self.stream(self.snapshot(('Platform',), teams=('team-a',), scope='all_work'),
                                    initiatives={}, plain={})
        self.assertEqual('success', frames[-1].get('outcome'), frames)
        self.assertEqual(['PLAN-E3'], self.children(frames))
        shells = [e for f in frames if f['type'] == 'column' for e in f['epics']]
        self.assertEqual(['PLAN-I2'], [e['key'] for e in shells])
        self.assertEqual('PLAN-I2', shells[0]['summary'])
        self.assertEqual('none', shells[0]['projectClassification'])

    def test_unreadable_allocation_parent_never_leaks_its_children(self):
        frames, _calls = self.stream(self.snapshot(('Platform',)), initiatives={}, plain={})
        self.assertEqual(0, frames[-1]['epicCount'])
        self.assertEqual([], self.children(frames))

    def test_parent_excluded_by_terminal_retention_drops_its_team_leaves(self):
        frames, calls = self.stream(self.snapshot(('Platform',), teams=('team-a',), scope='all_work'),
                                    initiatives={}, plain={'PLAN-I2': parent_shell('PLAN-I2', 'Done')})
        self.assertEqual(0, frames[-1]['epicCount'])
        self.assertEqual([], self.children(frames))
        self.assertFalse(any('key in ("PLAN-E3")' in p['jql'] for p in calls))
        self.assertTrue(all('AFTER -28d' in p['jql'] for p in calls if 'issuetype = 10001' in p['jql']))

    def test_matching_initiative_with_no_children_still_has_an_authoritative_card(self):
        with patch.object(self, 'LEAVES', {}):
            frames, _calls = self.stream(self.snapshot(('Platform',)))
        self.assertEqual('success', frames[-1].get('outcome'), frames)
        self.assertEqual(1, frames[-1]['epicCount'])
        self.assertEqual([], self.children(frames))

    def test_failed_allocation_discovery_is_terminal_never_empty_ready(self):
        frames, _calls = self.stream(self.snapshot(('Platform',)), fail_discovery=True)
        self.assertEqual('error', frames[-1]['type'])
        self.assertFalse(any(f['type'] == 'index' and f.get('membership') == 'authoritative' for f in frames))
        self.assertFalse(any(f['type'] == 'column' for f in frames))

    def test_allocation_missing_field_fails_closed_without_jira_search(self):
        def missing(bundle):
            bundle['configurations'][1]['fields']['allocation'] = {'fieldId': '', 'fieldName': ''}
        frames, calls = self.stream(self.snapshot(('Platform',), mutate=missing))
        self.assertEqual('error', frames[-1]['type'])
        self.assertEqual([], calls)

    def test_allocation_only_on_initiative_drives_stream_classes(self):
        def mapped(bundle):
            bundle['configurations'][1]['allocationTypes'] = [{'value': 'Platform', 'type': 'tech'}]
        frames, calls = self.stream(self.snapshot(('Platform',), mutate=mapped, allocation_types=[{'value': 'Platform', 'type': 'tech'}]))
        self.assertEqual('success', frames[-1].get('outcome'), frames)
        self.assertEqual({'tech'}, {child['projectClassification'] for frame in frames if frame['type'] == 'column'
                                   for child in frame['children']})
        for frame in frames:
            if frame['type'] in {'index', 'column'}:
                self.assertTrue(all(e['projectClassification'] == 'tech' for e in frame['epics']))
        self.assertFalse(any('issuetype = 10010' in p['jql'] for p in calls))
        self.assertTrue(all(('customfield_40001' in p['fields']) == ('issuetype = 10001' in p['jql']) for p in calls))

    def test_parent_and_leaf_unions_enforce_existing_issue_caps(self):
        for setting, cap in (('MAX_EPICS', 1), ('MAX_CHILDREN', 2)):
            with self.subTest(setting=setting), patch.object(eng_board, setting, cap):
                frames, _calls = self.stream(self.snapshot(('Platform',), teams=('team-a',), scope='all_work'))
                self.assertEqual('error', frames[-1]['type'])
                self.assertEqual('scope_too_large', frames[-1]['code'])
                self.assertFalse(any(f['type'] == 'index' and f.get('membership') == 'authoritative' for f in frames))

    def test_same_allocation_membership_uses_each_department_class(self):
        for classification in ('product', 'tech'):
            frames, _calls = self.stream(self.snapshot(('Platform',), allocation_types=[
                {'value': 'Platform', 'type': classification}]))
            self.assertEqual(frames[0]['scope'], 'allocation')
            self.assertEqual(frames[-1].get('outcome'), 'success', frames)
            cards = [row for frame in frames if frame['type'] == 'column' for row in frame['epics']]
            self.assertEqual([row['projectClassification'] for row in cards], [classification])
            children = [row for frame in frames if frame['type'] == 'column' for row in frame['children']]
            self.assertTrue(children)
            self.assertEqual({row['projectClassification'] for row in children}, {classification})

    def test_cohort_signature_follows_leaf_membership(self):
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
        set_up_db_oauth(self)
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

    def test_wrong_era_and_missing_allocation_fail_before_catalog_jira(self):
        from tests.oauth_test_helpers import install_oauth_session
        install_oauth_session(self.client)
        server = SimpleNamespace(current_jira_get=Mock(side_effect=AssertionError('Jira catalog')))
        cases = [('component', False, [{'value': 'Platform', 'type': 'tech'}], 'customfield_40001',
                  'board_scope_model_mismatch', 400),
                 ('allocation', True, [], '', 'board_scope_model_mismatch', 400),
                 ('allocation', False, [], 'customfield_40001', 'board_allocations_required', 409),
                 ('allocation', False, [{'value': 'Platform', 'type': 'tech'}], '',
                  'board_allocation_field_required', 409)]
        for scope, legacy, mapping, field, code, status in cases:
            def capture(_server, query, transport, _secret):
                group = {'id': 'd', 'allocationTypes': mapping, 'missingInfoComponents': ['Unrelated Legacy']}
                return eng_board_routes._capture_shape(server, query, transport, {}, group, group,
                    context=None, roles=SimpleNamespace(is_legacy=legacy, allocation_field_id=field))
            with self.subTest(scope=scope, code=code), \
                 patch.object(jira_server, 'JIRA_AUTH_MODE', 'atlassian_oauth'), \
                 patch.object(eng_board_routes, 'database_storage_enabled', return_value=True), \
                 patch.object(eng_board_routes, '_capture_snapshot', side_effect=capture):
                response = self.client.get('/api/eng/board', query_string={
                    'departmentId': 'd', 'scope': scope, 'quarter': '2027Q1'})
            self.assertEqual((response.status_code, response.get_json()), (status, {
                'error': code, 'message': 'The ENG Board request could not continue safely.'}))
        server.current_jira_get.assert_not_called()

    def test_selector_keys_are_accepted_by_the_query_parser(self):
        from werkzeug.datastructures import MultiDict
        query = eng_board_routes._parse_query(MultiDict([
            ('departmentId', 'd'), ('scope', 'all_work'), ('quarter', '2027Q1'),
            ('configurationId', 'delivery'), ('configurationRevision', '1')]))
        self.assertEqual(query.scope, 'all_work')
        with self.assertRaises(eng_board_routes.BoardRouteError):
            eng_board_routes._parse_query(MultiDict([('departmentId', 'd'), ('scope', 'all_work'), ('bogus', '1')]))
