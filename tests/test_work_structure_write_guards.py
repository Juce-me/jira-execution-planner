"""Own-key Jira writes and review routes under the admitted configuration stamp (Task 5A/5D backend).

All data is synthetic.  A scripted Jira transport records every call so stale or missing stamps can
assert zero Jira reads and writes; no real Jira, database or port is used.
"""
from copy import deepcopy
import os
import unittest
from unittest.mock import Mock, patch

import jira_server
from backend.db import models
from backend.routes import sprint_review_routes
from backend.services import work_structure as ws
from backend.services import work_write_scope
from tests.test_work_structure_routes import WorkStructureRouteBase

PARENT_TYPE, CHILD_TYPE = '10001', '10002'   # Initiative (level 2), Epic (level 1)
POINTS, TEAM, OWNER, TRACK = 'customfield_211', 'customfield_24', 'customfield_901', 'customfield_351'
UPDATED = '2027-01-05T10:00:00.000+0000'


class ScriptedJira:
    """Path-routed Jira transport that records calls and applies PUTs to its issue store."""

    def __init__(self, issues):
        self.issues = issues            # key -> {'type': (id, level, name), 'values': {field_id: raw}}
        self.calls = []
        self.puts = []

    def __call__(self, method, path, params=None, json_body=None, timeout=None, context=None, **_kwargs):
        self.calls.append((method, path))
        response = Mock(status_code=200, headers={})
        parts = path.split('/')
        if method == 'PUT':
            key = parts[-1]
            self.puts.append((key, json_body))
            self.issues[key]['values'].update({
                field_id: ({**value, 'displayName': 'Two'} if isinstance(value, dict) and 'accountId' in value else value)
                for field_id, value in json_body['fields'].items()})
            response.status_code = 204
            return response
        if path == '/rest/api/3/myself':
            me = {'accountId': context.atlassian_account_id, 'displayName': 'Me', 'active': True}
            response.json = lambda: me
            return response
        if path.startswith('/rest/api/3/user/'):
            response.json = lambda: [{'accountId': 'acc-2', 'displayName': 'Two', 'active': True}]
            return response
        if path.endswith('/editmeta'):
            response.json = lambda: {'fields': {
                POINTS: {'operations': ['set'], 'schema': {'type': 'number'}},
                OWNER: {'operations': ['set'], 'schema': {
                    'type': 'user', 'custom': 'com.atlassian.jira.plugin.system.customfieldtypes:userpicker'}},
                TRACK: {'operations': ['set'], 'allowedValues': [
                    {'id': '1', 'value': 'Flexible'}, {'id': '2', 'value': 'Committed'}]},
            }}
            return response
        issue = self.issues[parts[-1]]
        type_id, level, name = issue['type']
        fields = {'issuetype': {'id': type_id, 'name': name, 'subtask': False, 'hierarchyLevel': level},
                  'updated': UPDATED}
        for field_id in str((params or {}).get('fields', '')).split(','):
            if field_id.startswith('customfield_'):
                fields[field_id] = issue['values'].get(field_id)
        response.json = lambda: {'fields': fields}
        return response


class StampedRouteBase(WorkStructureRouteBase):
    def setUp(self):
        super().setUp()
        self.promoted_with_fields()
        self.jira = ScriptedJira({
            'DEMO-1': {'type': (CHILD_TYPE, 1, 'Epic'), 'values': {POINTS: 3}},
            'DEMO-2': {'type': (PARENT_TYPE, 2, 'Initiative'), 'values': {TRACK: {'value': 'Flexible'}}},
        })
        self.search = Mock(side_effect=AssertionError('Jira search must not run'))
        for name, target in (('current_jira_request', self.jira), ('current_jira_search', self.search)):
            self.stack.enter_context(patch.object(jira_server, name, target))

    def promoted_with_fields(self):
        def mutate(bundle):
            legacy, delivery = bundle['configurations']
            legacy['scope']['projects'] = [{'key': 'OLD', 'type': 'product'}]
            delivery['scope']['projects'] = [{'key': 'PLAN', 'type': 'other'}]
            delivery['hierarchy'].update(planningIssueTypeId=CHILD_TYPE, parentIssueTypeId=PARENT_TYPE)
            for name, field_id in (('sprint', 'customfield_10101'), ('storyPoints', POINTS), ('team', TEAM),
                                   ('deliveryOwner', OWNER), ('projectTrack', TRACK)):
                delivery['fields'][name] = {'fieldId': field_id, 'fieldName': name}
        self.seed(mutate=mutate)

    def mutate_row(self, change):
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            payload = deepcopy(row.payload)
            change(payload['workConfigurations'])
            row.payload = payload
            session.commit()

    def entry(self, index=1):
        payload, _revision = self.row()
        return ws.stored_bundle(payload)['configurations'][index]

    def stamp(self, index=1, quarter='2027Q1'):
        entry = self.entry(index)
        return {'id': entry['id'], 'revision': entry['revision'], 'quarter': quarter,
                'digest': ws.entry_digest(entry)}

    def query(self, stamp=None, **extra):
        stamp = stamp or self.stamp()
        return {'configurationId': stamp.get('id'), 'configurationRevision': str(stamp.get('revision')),
                'quarter': stamp.get('quarter'), 'configurationDigest': stamp.get('digest'), **extra}

    def post(self, path, body, headers=True):
        return self.client.post(path, json=body, headers=self.headers() if headers else None)

    def patch_review(self, body):
        return self.client.patch('/api/eng/sprints/17/review', json=body, headers=self.headers())

    def edit_body(self, field, value, base_value, stamp=None):
        meta = self.client.get(
            '/api/issues/DEMO-1/editable-fields' if field == 'storyPoints' else '/api/issues/DEMO-2/editable-fields',
            query_string=self.query(field=field), headers={'X-Requested-With': 'jira-execution-planner'}).get_json()
        return {'field': field, 'value': value, 'baseValue': base_value, 'baseUpdated': meta['baseUpdated'],
                'mappingRevision': meta['mappingRevision'], 'configuration': stamp or self.stamp()}


class OwnKeyWriteTests(StampedRouteBase):
    def test_points_write_the_epic_child_under_a_stamp(self):
        body = self.edit_body('storyPoints', 5, 3)
        response = self.post('/api/issues/DEMO-1/field', body)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['result'], 'success')
        self.assertEqual(self.jira.puts, [('DEMO-1', {'fields': {POINTS: 5}})])

    def test_points_on_the_initiative_parent_are_rejected_without_a_write(self):
        body = self.edit_body('storyPoints', 5, 3)
        response = self.post('/api/issues/DEMO-2/field', body)
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'issue_type_not_supported'))
        self.assertEqual(self.jira.puts, [])

    def test_delivery_owner_writes_the_initiative_key_and_never_the_epic(self):
        body = self.edit_body('deliveryOwner', {'accountId': 'acc-2'}, None)
        wrong = self.post('/api/issues/DEMO-1/field', body)
        self.assertEqual((wrong.status_code, wrong.get_json()['error']), (409, 'issue_type_not_supported'))
        self.assertEqual(self.jira.puts, [])
        response = self.post('/api/issues/DEMO-2/field', body)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(self.jira.puts, [('DEMO-2', {'fields': {OWNER: {'accountId': 'acc-2'}}})])

    def test_editable_metadata_marks_child_delivery_owner_unsupported(self):
        meta = self.client.get('/api/issues/DEMO-1/editable-fields', query_string=self.query(field='deliveryOwner'),
                               headers={'X-Requested-With': 'jira-execution-planner'}).get_json()
        self.assertEqual((meta['editable'], meta['reason']), (False, 'issue_type_not_supported'))

    def test_project_track_targets_the_initiative_own_key_only(self):
        options = self.client.get('/api/issues/project-track/options',
                                  query_string=self.query(issueKey='DEMO-2'))
        self.assertEqual(options.status_code, 200, options.get_data(as_text=True))
        response = self.post('/api/issues/project-track',
                             {'issueKey': 'DEMO-2', 'targetTrack': 'Committed', 'configuration': self.stamp()})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(self.jira.puts, [('DEMO-2', {'fields': {TRACK: {'id': '2'}}})])

    def test_project_track_on_an_epic_child_is_rejected_for_write_and_options(self):
        response = self.post('/api/issues/project-track',
                             {'issueKey': 'DEMO-1', 'targetTrack': 'Committed', 'configuration': self.stamp()})
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'issue_not_parent'))
        options = self.client.get('/api/issues/project-track/options', query_string=self.query(issueKey='DEMO-1'))
        self.assertEqual((options.status_code, options.get_json()['error']), (409, 'issue_not_parent'))
        self.assertEqual(self.jira.puts, [])

    def test_points_input_rejects_booleans_nulls_and_nonfinite_values_without_a_write(self):
        base = self.edit_body('storyPoints', 5, 3)
        for value in (True, False, None, float('inf'), float('nan'), '5', -1, 1.255):
            response = self.post('/api/issues/DEMO-1/field', {**base, 'value': value})
            self.assertEqual((response.status_code, response.get_json()['error']), (400, 'invalid_value'), value)
        self.assertEqual(self.jira.puts, [])
        null_baseline = self.post('/api/issues/DEMO-1/field', {**base, 'baseValue': None})
        self.assertEqual(null_baseline.get_json()['error'], 'stale_issue', 'null baseline stays null, never 0')

    def test_scoped_requests_never_read_ambient_field_getters(self):
        body = self.edit_body('storyPoints', 5, 3)
        with patch.object(jira_server, 'get_story_points_field_id', side_effect=AssertionError('ambient getter')), \
             patch.object(jira_server, 'get_project_track_field_id', side_effect=AssertionError('ambient getter')):
            self.assertEqual(self.post('/api/issues/DEMO-1/field', body).status_code, 200)
            self.assertEqual(self.post('/api/issues/project-track', {
                'issueKey': 'DEMO-2', 'targetTrack': 'Committed', 'configuration': self.stamp()}).status_code, 200)


class StampGuardTests(StampedRouteBase):
    """Every stamped route: stale -> 409 configuration_scope_changed, missing -> 409 configuration_required,
    malformed -> 400, always with zero Jira transport calls."""

    def routes(self, stamp):
        """(label, callable) over every stamped route; GET routes take the stamp as query names."""
        query = None if stamp is None else self.query(stamp)
        body = (lambda extra: {**extra, **({} if stamp is None else {'configuration': stamp})})
        xrw = {'X-Requested-With': 'jira-execution-planner'}
        return [
            ('editable', lambda: self.client.get('/api/issues/DEMO-1/editable-fields',
                                                 query_string={'field': 'storyPoints', **(query or {})}, headers=xrw)),
            ('user-options', lambda: self.post('/api/issues/DEMO-2/user-options',
                                               body({'field': 'deliveryOwner', 'query': 'two'}))),
            ('field', lambda: self.post('/api/issues/DEMO-1/field', body({
                'field': 'storyPoints', 'value': 5, 'baseValue': 3, 'baseUpdated': UPDATED, 'mappingRevision': 'x'}))),
            ('transition-options', lambda: self.client.post('/api/issues/transitions/options',
                                                            json=body({'issueKeys': ['DEMO-1']}), headers=xrw)),
            ('transitions', lambda: self.post('/api/issues/transitions',
                                              body({'issueKeys': ['DEMO-1'], 'targetStatus': 'Done'}))),
            ('priority-options', lambda: self.client.get('/api/issues/priorities/options',
                                                         query_string={'issueKey': 'DEMO-1', **(query or {})})),
            ('priorities', lambda: self.post('/api/issues/priorities',
                                             body({'issueKeys': ['DEMO-1'], 'targetPriorityId': '1'}))),
            ('track-options', lambda: self.client.get('/api/issues/project-track/options',
                                                      query_string={'issueKey': 'DEMO-2', **(query or {})})),
            ('track', lambda: self.post('/api/issues/project-track',
                                        body({'issueKey': 'DEMO-2', 'targetTrack': 'Committed'}))),
            ('review-get', lambda: self.client.get('/api/eng/sprints/17/review',
                                                   query_string={'groupId': 'group-x', **(query or {})})),
            ('review-read', lambda: self.post('/api/eng/sprints/17/review/values/read', body({
                'groupId': 'group-x', 'issueIds': ['101'], 'rowKind': 'epic'}))),
            ('review-patch', lambda: self.patch_review(body({
                'groupId': 'group-x', 'baseSchemaRevision': 0, 'schemaChanges': [], 'cellChanges': []}))),
        ]

    def assert_rejected(self, stamp, status, error):
        for label, call in self.routes(stamp):
            before = len(self.jira.calls)
            response = call()
            self.assertEqual((response.status_code, response.get_json().get('error')), (status, error), label)
            self.assertEqual(len(self.jira.calls), before, f'{label}: Jira must not be called')
        self.search.assert_not_called()
        self.assertEqual(self.jira.puts, [])

    def test_revision_bump_from_a_rename_or_edit_is_stale(self):
        stamp = self.stamp()

        def rename(bundle):
            bundle['configurations'][1]['name'] = 'DELIVERY 2027'
            bundle['configurations'][1]['revision'] += 1
        self.mutate_row(rename)
        self.assert_rejected(stamp, 409, 'configuration_scope_changed')

    def test_range_move_is_stale_for_the_old_quarter(self):
        stamp = self.stamp()

        def move(bundle):
            legacy, delivery = bundle['configurations']
            legacy['throughQuarter'], delivery['fromQuarter'] = '2027Q1', '2027Q2'
        self.mutate_row(move)
        self.assert_rejected(stamp, 409, 'configuration_scope_changed')

    def test_mapping_change_without_a_revision_bump_is_stale_by_digest(self):
        stamp = self.stamp()
        self.mutate_row(lambda bundle: bundle['configurations'][1]['hierarchy'].update(planningIssueTypeId='10009'))
        self.assert_rejected(stamp, 409, 'configuration_scope_changed')

    def test_missing_stamp_after_promotion_requires_a_configuration(self):
        self.assert_rejected(None, 409, 'configuration_required')

    def test_malformed_stamps_are_400(self):
        good = self.stamp()
        for bad, error in (
            ({**good, 'revision': True}, 'invalid_configuration_id'),
            ({**good, 'revision': '1'}, 'invalid_configuration_id'),
            ({**good, 'digest': 'NOT-HEX'}, 'invalid_configuration_id'),
            ({**good, 'id': 'bad id!'}, 'invalid_configuration_id'),
            ({**good, 'quarter': '2027q1'}, 'invalid_quarter'),
            ({**good, 'extra': 1}, 'invalid_configuration_id'),
            ({'id': good['id']}, 'invalid_configuration_id'),
        ):
            for label, call in self.routes(bad):
                if label.endswith(('editable', 'options', 'review-get')) or label in ('priority-options',):
                    continue  # query routes build their own names from a well-formed stamp
                response = call()
                self.assertEqual((response.status_code, response.get_json().get('error')), (400, error), (label, bad))
        self.assertEqual(self.jira.calls, [])
        null_stamp = self.client.post('/api/issues/transitions', json={'issueKeys': ['DEMO-1'], 'targetStatus': 'Done',
                                                                         'configuration': None}, headers=self.headers())
        self.assertEqual(null_stamp.status_code, 400)

    def test_query_stamp_must_be_single_valued_and_complete(self):
        xrw = {'X-Requested-With': 'jira-execution-planner'}
        stamp = self.stamp()
        for query in (
            [('field', 'storyPoints'), ('configurationId', stamp['id']), ('quarter', '2027Q1')],
            [('field', 'storyPoints'), ('configurationId', stamp['id']), ('configurationRevision', 'x'), ('quarter', '2027Q1')],
            [('field', 'storyPoints'), ('configurationId', stamp['id']), ('configurationId', 'again'),
             ('configurationRevision', '1'), ('quarter', '2027Q1')],
        ):
            response = self.client.get('/api/issues/DEMO-1/editable-fields', query_string=query, headers=xrw)
            self.assertEqual(response.status_code, 400, query)
        self.assertEqual(self.jira.calls, [])

    def test_site_priority_catalog_without_an_issue_stays_unscoped(self):
        with patch.object(work_write_scope, 'resolve_scope', side_effect=AssertionError('unscoped catalog must not resolve a stamp')), \
             patch('backend.routes.eng_routes.load_priority_options', return_value={'priorities': []}):
            response = self.client.get('/api/issues/priorities/options')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def test_stamped_transitions_pass_through_when_current(self):
        with patch('backend.routes.eng_routes.transition_issues', return_value={'succeeded': 0, 'results': []}) as run:
            response = self.post('/api/issues/transitions', {
                'issueKeys': ['DEMO-1'], 'targetStatus': 'Done', 'configuration': self.stamp()})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        run.assert_called_once()


class UnpromotedShapeTests(WorkStructureRouteBase):
    def setUp(self):
        super().setUp()
        self.seed(promoted=False)
        self.jira = Mock(side_effect=AssertionError('no Jira in this test'))
        self.stack.enter_context(patch.object(jira_server, 'current_jira_request', self.jira))

    def run_transition(self, body):
        with patch('backend.routes.eng_routes.transition_issues', return_value={'succeeded': 0, 'results': []}):
            return self.client.post('/api/issues/transitions', json=body, headers=self.headers())

    def test_unpromoted_requests_keep_their_shape_with_or_without_a_stamp(self):
        stamp = {'id': 'legacy', 'revision': 0, 'quarter': '2026Q4', 'digest': '0' * 32}
        for body in ({'issueKeys': ['DEMO-1'], 'targetStatus': 'Done'},
                     {'issueKeys': ['DEMO-1'], 'targetStatus': 'Done', 'configuration': stamp}):
            self.assertEqual(self.run_transition(body).status_code, 200)

    def test_stamp_with_the_feature_flag_off_is_refused_and_promoted_off_is_blocked(self):
        with patch.dict(os.environ, {'WORK_CONFIGURATIONS_ENABLED': 'false'}):
            response = self.run_transition({'issueKeys': ['DEMO-1'], 'targetStatus': 'Done',
                                            'configuration': {'id': 'legacy', 'revision': 0, 'quarter': '2026Q4',
                                                              'digest': '0' * 32}})
            self.assertEqual((response.status_code, response.get_json()['error']), (409, 'configuration_feature_disabled'))
            self.assertEqual(self.run_transition({'issueKeys': ['DEMO-1'], 'targetStatus': 'Done'}).status_code, 200)

    def test_promoted_workspace_with_the_flag_off_blocks_writes(self):
        self.mutate_promote()
        with patch.dict(os.environ, {'WORK_CONFIGURATIONS_ENABLED': 'false'}):
            response = self.run_transition({'issueKeys': ['DEMO-1'], 'targetStatus': 'Done'})
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'configuration_feature_disabled'))

    def mutate_promote(self):
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            payload = deepcopy(row.payload)
            payload['workConfigurations']['promotionRevision'] = 3
            row.payload = payload
            session.commit()


class ScopeUnitTests(unittest.TestCase):
    def test_role_needs_exact_mapped_id_and_level(self):
        scope = work_write_scope.WriteScope(
            'cfg', 1, 'd' * 32, '2027Q1', ws.MODEL_RND_2027, CHILD_TYPE, PARENT_TYPE, {})
        self.assertEqual(scope.role(CHILD_TYPE, 1), 'child')
        self.assertEqual(scope.role(PARENT_TYPE, 2), 'parent')
        for type_id, level in ((CHILD_TYPE, 2), (PARENT_TYPE, 1), ('10009', 1), (CHILD_TYPE, None), (CHILD_TYPE, True), ('', 1)):
            self.assertIsNone(scope.role(type_id, level), (type_id, level))

    def test_review_type_map_requires_both_mappings(self):
        scope = work_write_scope.WriteScope('cfg', 1, 'd' * 32, '2027Q1', ws.MODEL_RND_2027, CHILD_TYPE, None, {})
        with self.assertRaises(ws.WorkConfigError) as caught:
            scope.review_type_map()
        self.assertEqual(caught.exception.code, 'configuration_incomplete')
        legacy = work_write_scope.WriteScope('legacy', 0, 'd' * 32, '2026Q4', ws.MODEL_LEGACY, None, None, {})
        self.assertIsNone(legacy.review_type_map())
        self.assertIsNone(legacy.review_configuration_id)


class ReviewNamespaceRouteTests(StampedRouteBase):
    """Review routes pass the resolved namespace into the service; Legacy and new data never mix."""

    def setUp(self):
        super().setUp()
        with self.factory() as session:
            session.add(models.WorkspaceGroupConfig(workspace_id=self.workspace_id, payload={
                'version': 1, 'groups': [{'id': 'group-x', 'name': 'Platform'}], 'defaultGroupId': 'group-x'}))
            session.commit()
        self.types = {'900': (PARENT_TYPE, 2), '101': (CHILD_TYPE, 1)}
        self.search = Mock(side_effect=self._search)
        self.stack.enter_context(patch.object(jira_server, 'current_jira_search', self.search))
        self.admit = self.stack.enter_context(patch.object(sprint_review_routes, '_admit_sprint'))

    def _search(self, payload, **_kwargs):
        ids = payload['jql'].split('(')[1].split(')')[0].split(',')

        def issue(identity):
            type_id, level = self.types.get(identity, ('10003', 0))
            return {'id': identity, 'fields': {'issuetype': {
                'id': type_id, 'name': 'T', 'subtask': False, 'hierarchyLevel': level}}}
        return Mock(status_code=200, json=lambda: {'issues': [issue(i) for i in ids], 'isLast': True})

    def column(self):
        return {'id': '11111111-1111-4111-8111-111111111111', 'rowKind': 'initiative', 'label': 'Plan',
                'type': 'number', 'aggregation': 'sum'}

    def patch_body(self, cells=(), schema=True, stamp=None):
        return {'groupId': 'group-x', 'baseSchemaRevision': 0, 'baseViewRevision': 0,
                'schemaChanges': [{'action': 'add', 'column': self.column()}] if schema else [],
                'cellChanges': list(cells), 'configuration': stamp or self.stamp()}

    def test_new_namespace_save_is_isolated_from_legacy_and_admits_the_sprint(self):
        response = self.patch_review(self.patch_body())
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['configurationId'], self.stamp()['id'])
        self.admit.assert_called_once()
        self.assertEqual(self.admit.call_args.args[2], '17')
        new = self.client.get('/api/eng/sprints/17/review', query_string={'groupId': 'group-x', **self.query()})
        self.assertEqual([c['rowKind'] for c in new.get_json()['columns']], ['initiative'])
        legacy_stamp = self.stamp(0, '2026Q4')
        old = self.client.get('/api/eng/sprints/17/review', query_string={'groupId': 'group-x', **self.query(legacy_stamp)})
        self.assertEqual(old.status_code, 200, old.get_data(as_text=True))
        self.assertEqual(old.get_json()['columns'], [])
        self.assertNotIn('configurationId', old.get_json())

    def test_cells_authorize_by_mapped_type_and_level_and_reject_other_ids(self):
        saved = self.patch_review(self.patch_body())
        self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
        schema_revision = saved.get_json()['schemaRevision']
        cell = {'issueId': '900', 'rowKind': 'initiative', 'columnId': self.column()['id'], 'value': '4', 'baseRevision': 0}
        body = {**self.patch_body(cells=[cell], schema=False), 'baseSchemaRevision': schema_revision,
                'baseViewRevision': saved.get_json().get('viewRevision', 0)}
        self.assertEqual(self.patch_review(body).status_code, 200)
        wrong = {**body, 'cellChanges': [{**cell, 'issueId': '101'}]}
        denied = self.patch_review(wrong)
        self.assertEqual((denied.status_code, denied.get_json()['error']), (403, 'review_issues_unavailable'))
        read = self.post('/api/eng/sprints/17/review/values/read', {
            'groupId': 'group-x', 'issueIds': ['900'], 'rowKind': 'initiative', 'configuration': self.stamp()})
        self.assertEqual(read.status_code, 200, read.get_data(as_text=True))
        self.assertEqual([c['issueId'] for c in read.get_json()['cells']], ['900'])

    def test_stamp_is_not_passed_to_the_service_and_legacy_stamp_keeps_null_namespace(self):
        with patch.object(sprint_review_routes.sprint_review, 'save_review', return_value={'ok': True}) as save:
            self.patch_review(self.patch_body())
            kwargs = save.call_args.kwargs
            self.assertNotIn('configuration', save.call_args.args[2])
            self.assertEqual(kwargs['configuration_id'], self.stamp()['id'])
            self.assertEqual(kwargs['quarter_ordinal'], (2027 - 1) * 4)
            self.assertEqual(kwargs['type_map'], {'epic': (CHILD_TYPE, 1), 'initiative': (PARENT_TYPE, 2)})
            self.patch_review(self.patch_body(stamp=self.stamp(0, '2026Q4')))
            self.assertEqual(save.call_args.kwargs, {})

    def test_sprint_outside_the_configuration_catalog_is_rejected_before_the_service(self):
        self.admit.side_effect = ws.WorkConfigError('sprint_catalog_mismatch')
        with patch.object(sprint_review_routes.sprint_review, 'save_review', side_effect=AssertionError('service')):
            response = self.patch_review(self.patch_body())
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'sprint_catalog_mismatch'))


if __name__ == '__main__':
    unittest.main()
