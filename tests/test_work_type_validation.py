"""New-model work whose Jira parent is not of the configured type (plan EXEC-work-entity-names Task 3).

The full Catch Up tasks read reports ``workTypes``: the Jira names it observed for the planning and parent role
types and the links whose parent is of another type.  Rows are never dropped; a permission-reduced parent (no
issue type) is unknown and never counted; Legacy reports nothing.  Synthetic keys and ids only.
"""
import re
import unittest
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from unittest.mock import Mock, patch

import jira_server
from backend.routes import work_structure_routes as work_routes
from backend.services import planning_work
from tests.test_work_structure_routes import WorkStructureRouteBase, jira_response

PLANNING, PARENT, ANCESTOR = '6', '11700', '12723'
SPRINT_FIELD, POINTS_FIELD, TEAM_FIELD = 'customfield_26', 'customfield_211', 'customfield_24'


class TypedSearch:
    """Scripted ``jira_search_request`` that honours the JQL type filter: planning rows only for the planning type."""

    def __init__(self, planning_rows, parent_rows=()):
        self.planning_rows = list(planning_rows)
        self.parent_rows = {row['key']: row for row in parent_rows}
        self.calls = []

    def __call__(self, payload, *args, **kwargs):
        jql = payload['jql']
        self.calls.append(jql)
        if jql.startswith('issueKey in'):
            keys = re.findall(r'[A-Z]+-\d+', jql)
            rows = [self.parent_rows[key] for key in keys if key in self.parent_rows]
        elif re.search(rf'issuetype = {PLANNING}\b', jql):
            rows = self.planning_rows
        else:
            rows = []
        return jira_response(200, {'issues': rows, 'isLast': True})


def typed(type_id, name):
    return {'id': type_id, 'name': name}


def planning_row(key, parent_key=None, parent_type=None):
    fields = {'summary': key, 'status': {'name': 'To Do'}, 'issuetype': typed(PLANNING, 'Epic'),
              'project': {'key': 'PLAN', 'name': 'Plan'}, POINTS_FIELD: 3}
    if parent_key:
        parent_fields = {'summary': parent_key}
        if parent_type is not None:
            parent_fields['issuetype'] = parent_type
        fields['parent'] = {'key': parent_key, 'fields': parent_fields}
    return {'key': key, 'id': key.split('-')[1], 'fields': fields}


def parent_row(key, ancestor_key=None, ancestor_type=None):
    fields = {'summary': key, 'status': {'name': 'To Do'}, 'issuetype': typed(PARENT, 'Initiative'),
              'project': {'key': 'PLAN'}, 'components': []}
    if ancestor_key:
        ancestor_fields = {'summary': ancestor_key}
        if ancestor_type is not None:
            ancestor_fields['issuetype'] = ancestor_type
        fields['parent'] = {'key': ancestor_key, 'fields': ancestor_fields}
    return {'key': key, 'id': key.split('-')[1], 'fields': fields}


def seed_types(bundle, ancestor=ANCESTOR):
    legacy, delivery = bundle['configurations']
    legacy['scope']['projects'] = [{'key': 'OLD', 'type': 'product'}, {'key': 'OLDB', 'type': 'tech'}]
    legacy['scope']['boardId'] = '7001'
    delivery['scope']['projects'] = [{'key': 'PLAN', 'type': 'other'}]
    delivery['hierarchy'].update(planningIssueTypeId=PLANNING, parentIssueTypeId=PARENT,
                                 ancestorIssueTypeId=ancestor)
    for name in ('sprint', 'storyPoints', 'team'):
        delivery['fields'][name] = {'fieldId': f'customfield_2{len(name)}', 'fieldName': name}
    legacy['fields']['team'] = dict(delivery['fields']['team'])
    delivery['fields']['team'] = {'fieldId': '', 'fieldName': '', 'mode': 'shared'}


class WorkTypesRouteTests(WorkStructureRouteBase):
    ancestor = ANCESTOR

    def setUp(self):
        super().setUp()
        self.seed(mutate=partial(seed_types, ancestor=self.ancestor))
        self.stack.enter_context(patch.object(jira_server, 'resolve_request_catalog_sources', return_value=[Mock()]))
        self.stack.enter_context(patch.object(
            work_routes, 'admit_sprint_source', return_value=(Mock(), {'id': 5, 'name': '2027Q1'})))

    def run_tasks(self, params, search):
        with patch.object(jira_server, 'jira_search_request', side_effect=search):
            response = self.client.get('/api/tasks', query_string=params)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()

    def delivery_digest(self):
        from backend.db import models
        from backend.services import work_structure as ws
        with self.factory() as session:
            payload = session.query(models.WorkspaceDashboardConfig).one().payload
        snapshot = type('Snapshot', (), {'payload': payload})()
        return ws.resolve_work_configuration(snapshot, quarter='2027Q1', flag_enabled=True).digest


class ParentLinkMismatchTests(WorkTypesRouteTests):
    def test_parent_of_another_type_is_counted_and_every_row_stays(self):
        search = TypedSearch(
            [planning_row('PLAN-1', 'I-1', typed(PARENT, 'Initiative')),
             planning_row('PLAN-2', 'S-9', typed('10001', 'Story')),
             planning_row('PLAN-3', 'P-3')],          # permission-reduced parent: no issue type
            [parent_row('I-1'), parent_row('P-3')])
        body = self.run_tasks({'quarter': '2027Q1'}, search)
        self.assertEqual([issue['key'] for issue in body['issues']], ['PLAN-1', 'PLAN-2', 'PLAN-3'])
        self.assertEqual(body['workTypes'], {
            'digest': self.delivery_digest(),
            'observed': {'planning': 'Epic', 'parent': 'Initiative'},
            'linkMismatches': {'parentCount': 1, 'ancestorCount': 0, 'keys': ['PLAN-2']},
        })
        # The row shape is unchanged: the trimmed issuetype carries the name only.
        self.assertEqual(body['issues'][0]['fields']['issuetype'], {'name': 'Epic'})

    def test_parent_of_another_ancestor_type_is_counted_and_its_ancestor_dropped(self):
        search = TypedSearch([planning_row('PLAN-1', 'I-1', typed(PARENT, 'Initiative'))],
                             [parent_row('I-1', 'O-1', typed('10002', 'Theme'))])
        body = self.run_tasks({'quarter': '2027Q1'}, search)
        self.assertEqual(body['workTypes']['linkMismatches'], {'parentCount': 0, 'ancestorCount': 1, 'keys': ['I-1']})
        self.assertNotIn('initiative', body['epics']['I-1'])

    def test_matching_ancestor_is_attached_and_not_counted(self):
        search = TypedSearch([planning_row('PLAN-1', 'I-1', typed(PARENT, 'Initiative'))],
                             [parent_row('I-1', 'O-1', typed(ANCESTOR, 'Objective'))])
        body = self.run_tasks({'quarter': '2027Q1'}, search)
        self.assertEqual(body['workTypes']['linkMismatches'], {'parentCount': 0, 'ancestorCount': 0, 'keys': []})
        self.assertEqual(body['epics']['I-1']['initiative'], {'key': 'O-1', 'summary': 'O-1'})

    def test_count_is_complete_and_keys_are_capped_at_twenty(self):
        rows = [planning_row(f'PLAN-{n}', f'S-{n}', typed('10001', 'Story')) for n in range(1, 26)]
        body = self.run_tasks({'quarter': '2027Q1'}, TypedSearch(rows))
        mismatches = body['workTypes']['linkMismatches']
        self.assertEqual(mismatches['parentCount'], 25)
        self.assertEqual(mismatches['keys'], [f'PLAN-{n}' for n in range(1, 21)])
        self.assertEqual(len(body['issues']), 25)

    def test_cache_hit_returns_the_same_work_types(self):
        search = TypedSearch([planning_row('PLAN-2', 'S-9', typed('10001', 'Story'))])
        first = self.run_tasks({'quarter': '2027Q1'}, search)
        calls = len(search.calls)
        second = self.run_tasks({'quarter': '2027Q1'}, search)
        self.assertEqual(len(search.calls), calls)  # served from cache
        self.assertEqual(second['workTypes'], first['workTypes'])
        self.assertEqual(second['workTypes']['linkMismatches']['keys'], ['PLAN-2'])

    def test_purposed_reads_and_legacy_report_no_work_types(self):
        search = TypedSearch([planning_row('PLAN-2', 'S-9', typed('10001', 'Story'))])
        self.assertNotIn('workTypes', self.run_tasks({'quarter': '2027Q1', 'purpose': 'alerts'}, search))
        legacy = self.run_tasks({'quarter': '2026Q4'}, TypedSearch([]))
        self.assertNotIn('workTypes', legacy)


class NoAncestorTypeTests(WorkTypesRouteTests):
    ancestor = ''

    def test_without_an_ancestor_type_ancestor_links_are_not_checked(self):
        search = TypedSearch([planning_row('PLAN-1', 'I-1', typed(PARENT, 'Initiative'))],
                             [parent_row('I-1', 'O-1', typed('10002', 'Theme'))])
        body = self.run_tasks({'quarter': '2027Q1'}, search)
        self.assertEqual(body['workTypes']['linkMismatches'], {'parentCount': 0, 'ancestorCount': 0, 'keys': []})


class WorkerCollectorTests(unittest.TestCase):
    def roles(self):
        from tests.test_planning_work_profiles import bundle, context

        def mutate(value):
            value['configurations'][1]['hierarchy'].update(
                planningIssueTypeId=PLANNING, parentIssueTypeId=PARENT, ancestorIssueTypeId=ANCESTOR)
        return planning_work.WorkRoles(context('2027Q1', bundle(mutate)))

    def test_collector_fills_from_a_worker_without_a_request_context_through_the_real_wrapper(self):
        roles = self.roles()
        wrapper_calls = []

        def current_search(payload, **_kwargs):
            wrapper_calls.append(payload['jql'])
            return jira_response(200, {'issues': [
                parent_row('I-1', 'O-1', typed('10002', 'Theme')),
                parent_row('I-2', 'O-2', typed(ANCESTOR, 'Objective')),
                parent_row('I-3', 'O-3')]})   # permission-reduced ancestor: unknown, not counted

        misses = []
        fetcher = partial(jira_server.fetch_epic_details_bulk, roles=roles, ancestor_misses=misses)
        with patch.object(jira_server, 'current_jira_search', side_effect=current_search), \
                ThreadPoolExecutor(max_workers=1) as pool:
            details = pool.submit(fetcher, ['I-1', 'I-2', 'I-3'], None, None).result()
        self.assertEqual(len(wrapper_calls), 1)
        self.assertEqual(misses, ['I-1'])
        self.assertEqual(sorted(details), ['I-1', 'I-2', 'I-3'])
        self.assertEqual(details['I-2']['initiative'], {'key': 'O-2', 'summary': 'O-2'})
        self.assertNotIn('initiative', details['I-1'])

    def test_return_value_is_unchanged_without_a_collector(self):
        roles = self.roles()
        rows = [parent_row('I-1', 'O-1', typed('10002', 'Theme'))]
        with patch.object(jira_server, 'current_jira_search',
                          side_effect=lambda payload, **_: jira_response(200, {'issues': rows})):
            with_collector = jira_server.fetch_epic_details_bulk(['I-1'], None, None, roles=roles, ancestor_misses=[])
            without = jira_server.fetch_epic_details_bulk(['I-1'], None, None, roles=roles)
        self.assertEqual(with_collector, without)


class SummarizeLinksTests(unittest.TestCase):
    def test_observed_names_come_from_typed_rows_and_role_matching_parents(self):
        roles = WorkerCollectorTests().roles()
        summary = roles.summarize_links(
            [planning_row('PLAN-3', 'P-3'), planning_row('PLAN-2', 'S-9', typed('10001', 'Story')),
             planning_row('PLAN-1', 'I-1', typed(PARENT, 'Big rock'))],
            {'I-1': {}, 'P-3': {}}, ['I-1'])
        self.assertEqual(summary, {
            'observed': {'planning': 'Epic', 'parent': 'Big rock'},
            'linkMismatches': {'parentCount': 1, 'ancestorCount': 1, 'keys': ['PLAN-2', 'I-1']},
        })

    def test_nothing_observed_is_null(self):
        roles = WorkerCollectorTests().roles()
        self.assertEqual(roles.summarize_links([], {}, []), {
            'observed': {'planning': None, 'parent': None},
            'linkMismatches': {'parentCount': 0, 'ancestorCount': 0, 'keys': []},
        })


if __name__ == '__main__':
    unittest.main()
