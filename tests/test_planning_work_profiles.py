"""Planning work facade and role profiles (plan Task 4A): Legacy adapter vs rnd_2027 model."""
import re
import unittest
from copy import deepcopy

from backend.services import eng_board
from backend.services import planning_work as pw
from backend.services import work_structure as ws
from backend.services.workspace_dashboard_config import WorkspaceConfigSnapshot
from tests.fixtures import work_structure_reference as ref

SPRINT = 'customfield_10101'
POINTS = 'customfield_10004'
TEAM = 'customfield_30101'
ALLOCATION = 'customfield_40001'
EPIC_LINK = 'customfield_10014'


def bundle(mutate=None, legacy_payload=None):
    value = ws.capture_virtual_bundle(legacy_payload or {})
    legacy, delivery = value['configurations']
    legacy['scope']['projects'] = [{'key': 'OLD', 'type': 'product'}, {'key': 'OLDB', 'type': 'tech'}]
    legacy['scope']['boardId'] = '7001'
    delivery['scope']['projects'] = [{'key': 'PLAN', 'type': 'other'}]
    delivery['hierarchy'].update(planningIssueTypeId='10002', parentIssueTypeId='10001',
                                 ancestorIssueTypeId='10010', optionalAncestorIssueTypeId='10011')
    for name, field_id in (('sprint', SPRINT), ('storyPoints', POINTS), ('team', TEAM),
                           ('allocation', ALLOCATION)):
        delivery['fields'][name] = {'fieldId': field_id, 'fieldName': name}
    if mutate:
        mutate(value)
    return value


def snapshot(value=None):
    value = deepcopy(value or bundle())
    for entry in value['configurations']:
        entry['revision'] = 1
    value['promotionRevision'] = 3
    return WorkspaceConfigSnapshot({'workConfigurations': value}, 3, 'workspace_db')


def context(quarter='2027Q1', value=None):
    return ws.resolve_work_configuration(snapshot(value), quarter=quarter, flag_enabled=True)


def roles(quarter='2027Q1', value=None):
    return pw.WorkRoles(context(quarter, value))


class FakeJira:
    """Scripted search: each responder takes (jql, payload) and returns issues or raises."""

    def __init__(self, *responders):
        self.responders = list(responders)
        self.calls = []

    def search(self, payload):
        self.calls.append(payload)
        for pattern, answer in self.responders:
            if re.search(pattern, payload['jql']):
                result = answer(payload) if callable(answer) else answer
                if isinstance(result, Exception):
                    raise result
                return {'issues': result, 'isLast': True} if isinstance(result, list) else result
        return {'issues': [], 'isLast': True}


def epic(key, parent=None, points=None, status='To Do', components=(), sprint=None, team=None,
         allocation=None):
    fields = {'summary': key, 'status': {'id': '1', 'name': status}, 'issuetype': {'id': '10002', 'name': 'Epic'},
              POINTS: points, 'components': [{'name': name} for name in components]}
    if parent:
        fields['parent'] = {'key': parent}
    if sprint:
        fields[SPRINT] = [{'id': sprint}]
    if team:
        fields[TEAM] = {'id': team}
    if allocation is not None:
        fields[ALLOCATION] = allocation
    return {'key': key, 'id': key[-1], 'fields': fields}


def parent_issue(key, parent=None, components=(), status='To Do'):
    fields = {'summary': key, 'status': {'id': '1', 'name': status}, 'issuetype': {'id': '10001', 'name': 'Initiative'},
              'components': [{'name': name} for name in components]}
    if parent:
        fields['parent'] = {'key': parent}
    return {'key': key, 'id': key[-1], 'fields': fields}


class RoleTypeTests(unittest.TestCase):
    def test_legacy_task_stats_interpretations_are_exact(self):
        for _case, config, expected in ref.TASK_STATS_ISSUE_TYPE_CASES:
            value = bundle(legacy_payload=config)
            clause = roles('2026Q4', value).planning_clause()
            if expected == []:
                self.assertEqual(clause, '')
            elif len(expected) == 1:
                self.assertEqual(clause, f'type = "{expected[0]}"')
            else:
                self.assertEqual(clause, 'type in (' + ', '.join(f'"{item}"' for item in expected) + ')')

    def test_board_empty_list_is_every_eligible_level_zero_type_not_unrestricted_tasks(self):
        for _case, present, names, expected in ref.BOARD_ISSUE_TYPE_CASES:
            payload = {'issueTypes': names} if present else {}
            ids = roles('2026Q4', bundle(legacy_payload=payload)).board_planning_type_ids(ref.BOARD_ISSUE_TYPE_CATALOG)
            self.assertEqual(ids, expected)
        # [] differs by surface: tasks/stats unrestricted, Board all eligible non-subtask level zero.
        both = roles('2026Q4', bundle(legacy_payload={'issueTypes': []}))
        self.assertEqual(both.planning_clause(), '')
        self.assertEqual(both.board_planning_type_ids(ref.BOARD_ISSUE_TYPE_CATALOG), ('90001', '90002', '90003'))

    def test_new_model_uses_mapped_type_ids(self):
        delivery = roles()
        self.assertEqual(delivery.planning_clause(), 'issuetype = 10002')
        self.assertEqual(delivery.parent_clause(), 'issuetype = 10001')
        self.assertEqual(delivery.non_parent_clause(), 'issuetype != 10001')
        self.assertEqual(delivery.ancestor_clause(), 'issuetype = 10010')
        self.assertEqual(delivery.optional_ancestor_term(), ('id', '10011'))
        self.assertEqual(delivery.board_planning_type_ids([]), ('10002',))

    def test_legacy_compatibility_parent_and_ancestor_keep_names(self):
        legacy = roles('2026Q4')
        self.assertEqual(legacy.parent_clause(), 'issuetype = Epic')
        self.assertEqual(legacy.non_parent_clause(), 'issuetype != Epic')
        self.assertEqual(legacy.ancestor_clause(), 'issuetype = Initiative')
        self.assertIsNone(legacy.optional_ancestor_term())

    def test_mapped_legacy_parent_uses_its_id_and_cleared_parent_is_incomplete(self):
        def mapped(value):
            legacy = value['configurations'][0]
            legacy['legacyHierarchyModes']['parent'] = 'mapped'
            legacy['hierarchy']['parentIssueTypeId'] = '10001'
        self.assertEqual(roles('2026Q4', bundle(mapped)).parent_clause(), 'issuetype = 10001')

        def cleared(value):
            value['configurations'][0]['legacyHierarchyModes']['parent'] = 'mapped'
        with self.assertRaises(ws.WorkConfigError) as raised:
            roles('2026Q4', bundle(cleared)).parent_clause()
        self.assertEqual(raised.exception.code, 'configuration_incomplete')

    def test_epic_link_is_only_the_story_to_epic_relationship(self):
        self.assertEqual(roles('2026Q4').children_clause(['"A-1"']),
                         '("Epic Link" in ("A-1") OR parent in ("A-1"))')
        self.assertEqual(roles().children_clause(['"A-1"']), 'parent in ("A-1")')
        story = {'key': 'OLD-1', 'fields': {EPIC_LINK: 'old-e1', 'parent': {'key': 'OLD-P'}}}
        self.assertEqual(roles('2026Q4').parent_key_of(story, EPIC_LINK), 'OLD-E1')
        self.assertEqual(roles().parent_key_of(story, EPIC_LINK), 'OLD-P')

    def test_team_and_sprint_clauses_follow_each_adapter(self):
        self.assertEqual(roles('2026Q4').team_clause(['t1']), '"Team[Team]" = "t1"')
        self.assertEqual(roles().team_clause(['t1', 't2']), 'cf[30101] in ("t1", "t2")')
        self.assertEqual(roles('2026Q4').sprint_clause('12'), 'Sprint = 12')
        self.assertEqual(roles().sprint_clause('12'), 'cf[10101] = 12')
        with self.assertRaises(ws.WorkConfigError):
            roles().sprint_clause('12 OR 1=1')

    def test_blank_mapped_field_is_missing_never_a_default(self):
        def blank_team(value):
            # Team is one field for every configuration: a Team left blank in Legacy is blank for DELIVERY too.
            value['configurations'][0]['fields']['team'] = {'fieldId': '', 'fieldName': ''}
            value['configurations'][1]['fields']['team'] = {'fieldId': '', 'fieldName': '', 'mode': 'shared'}
        blank = roles('2027Q1', bundle(blank_team))
        self.assertEqual(blank.team_field_id, '')
        with self.assertRaises(ws.WorkConfigError):
            blank.team_clause(['t1'])

    def test_env_jql_query_overrides_projects_in_both_eras(self):
        for quarter in ('2026Q4', '2027Q1'):
            current = roles(quarter)
            self.assertEqual(current.base_jql('project = ENV'), 'project = ENV')
            self.assertIn('project in (', current.base_jql(''))

    def test_planning_jql_uses_one_unfiltered_project_lane(self):
        jql = roles().planning_jql(['t1'], '12')
        self.assertEqual(jql.count('project in ('), 1)
        self.assertIn('"PLAN"', jql)
        self.assertNotIn('OLD', jql)
        self.assertIn('issuetype = 10002', jql)


class LoadPlanningWorkTests(unittest.TestCase):
    def work(self, jira, quarter='2027Q1', **kwargs):
        selected = context(quarter)
        return pw.load_planning_work(selected, None, quarter, kwargs.pop('team_ids', ()), 'tasks', jira.search,
                                     **kwargs)

    def test_epic_to_initiative_through_parent_with_two_bounded_hops_and_no_fan_out(self):
        epics = [epic(f'PLAN-{n}', parent=f'PLAN-I{n % 3}') for n in range(1, 8)]
        jira = FakeJira(
            (r'issuetype = 10002', epics),
            (r'key in \("PLAN-I', lambda payload: [
                parent_issue(key, parent='PLAN-O1')
                for key in re.findall(r'PLAN-I\d', payload['jql'])]),
            (r'key in \("PLAN-O1', [parent_issue('PLAN-O1', parent='PLAN-S1')]),
        )
        work = self.work(jira)
        self.assertEqual(len(work.issues), 7)
        self.assertEqual(sorted(work.parents), ['PLAN-I0', 'PLAN-I1', 'PLAN-I2'])
        self.assertEqual(sorted(work.ancestors), ['PLAN-O1'])
        self.assertEqual(sorted(work.optional_ancestors), ['PLAN-S1'])
        self.assertEqual(work.hops, 2)
        self.assertTrue(work.complete)
        # planning + one parent batch + one ancestor batch: never per-issue.
        self.assertEqual(len(jira.calls), 3)
        self.assertTrue(all(len(re.findall(r'"PLAN-', call['jql'])) <= pw.PARENT_BATCH_LIMIT
                            for call in jira.calls[1:]))

    def test_hydration_batches_stay_within_the_bound_and_the_page_budget(self):
        epics = [epic(f'PLAN-{n}', parent=f'PLAN-{1000 + n}') for n in range(1, 301)]
        jira = FakeJira((r'issuetype = 10002', epics))
        work = self.work(jira)
        self.assertEqual(len(work.unavailable_parents), 300)
        for call in jira.calls[1:]:
            keys = re.findall(r'"(PLAN-\d+)"', call['jql'])
            self.assertLessEqual(len(keys), min(pw.PARENT_BATCH_LIMIT, eng_board.MAX_BATCH_SIZE))
        self.assertEqual(len(jira.calls), 1 + 8)  # 300 keys / 40-key batches, no per-issue request

    def test_planning_pages_follow_next_page_token_and_page_ceiling_is_incomplete_not_empty(self):
        pages = {
            None: {'issues': [epic('PLAN-1')], 'isLast': False, 'nextPageToken': 't1'},
            't1': {'issues': [epic('PLAN-2')], 'isLast': False, 'nextPageToken': 't2'},
            't2': {'issues': [epic('PLAN-3')], 'isLast': True},
        }
        jira = FakeJira((r'issuetype = 10002', lambda payload: pages[payload.get('nextPageToken')]))
        self.assertEqual([i['key'] for i in self.work(jira).issues], ['PLAN-1', 'PLAN-2', 'PLAN-3'])
        jira = FakeJira((r'issuetype = 10002', lambda payload: pages[payload.get('nextPageToken')]))
        capped = self.work(jira, max_pages=2)
        self.assertFalse(capped.complete)
        self.assertEqual(len(capped.issues), 2)
        self.assertIn('planning_search_ceiling', capped.incomplete_reasons)

    def test_unreadable_parent_never_erases_readable_rows_and_is_unavailable(self):
        epics = [epic('PLAN-1', parent='PLAN-I1'), epic('PLAN-2')]
        jira = FakeJira((r'issuetype = 10002', epics))
        work = self.work(jira)
        self.assertEqual([i['key'] for i in work.issues], ['PLAN-1', 'PLAN-2'])
        self.assertEqual(work.parent_state, {'PLAN-1': 'unavailable', 'PLAN-2': 'none'})
        self.assertEqual(work.unavailable_parents, {'PLAN-I1'})

    def test_failed_parent_hydration_keeps_rows_and_marks_incomplete(self):
        jira = FakeJira((r'issuetype = 10002', [epic('PLAN-1', parent='PLAN-I1')]),
                        (r'key in', pw.SearchUnavailable('boom')))
        work = self.work(jira)
        self.assertEqual(len(work.issues), 1)
        self.assertFalse(work.complete)
        self.assertIn('parent_hydration_incomplete', work.incomplete_reasons)

    def test_legacy_story_epic_uses_epic_link_new_model_ignores_it(self):
        story = {'key': 'OLD-1', 'fields': {EPIC_LINK: 'OLD-E1', 'parent': {'key': 'OLD-X'}, SPRINT: None}}
        jira = FakeJira((r'type = "Story"', [story]), (r'key in \("OLD-E1"', [parent_issue('OLD-E1')]))
        legacy = pw.load_planning_work(context('2026Q4'), None, '2026Q4', (), 'tasks', jira.search,
                                       epic_link_field_id=EPIC_LINK)
        self.assertEqual(sorted(legacy.parents), ['OLD-E1'])
        jira = FakeJira((r'issuetype = 10002', [epic('PLAN-1', parent='PLAN-I1')]),
                        (r'key in \("PLAN-I1"', [parent_issue('PLAN-I1')]))
        delivery = self.work(jira, epic_link_field_id=EPIC_LINK)
        self.assertEqual(sorted(delivery.parents), ['PLAN-I1'])
        self.assertNotIn(EPIC_LINK, ' '.join(call['jql'] for call in jira.calls))

    def test_optional_children_are_one_batched_search_and_failure_keeps_rows(self):
        jira = FakeJira((r'issuetype = 10002', [epic('PLAN-1'), epic('PLAN-2')]),
                        (r'parent in \(', [{'key': 'PLAN-9', 'fields': {'parent': {'key': 'PLAN-1'}}}]))
        work = self.work(jira, include_children=True)
        self.assertEqual(sorted(work.children), ['PLAN-1'])
        self.assertEqual(len(jira.calls), 2)
        failing = FakeJira((r'issuetype = 10002', [epic('PLAN-1')]), (r'parent in \(', pw.SearchUnavailable('x')))
        partial = self.work(failing, include_children=True)
        self.assertEqual(len(partial.issues), 1)
        self.assertFalse(partial.complete)

    def test_quarter_mismatch_is_scope_changed(self):
        with self.assertRaises(ws.WorkConfigError) as raised:
            pw.load_planning_work(context('2027Q1'), None, '2027Q2', (), 'tasks', FakeJira().search)
        self.assertEqual(raised.exception.code, 'configuration_scope_changed')

    def test_dependencies_are_read_from_issue_links_without_extra_requests(self):
        linked = epic('PLAN-1')
        linked['fields']['issuelinks'] = [
            {'type': {'name': 'Blocks'}, 'outwardIssue': {'key': 'PLAN-2'}},
            {'type': {'name': 'Blocks'}, 'inwardIssue': {'key': 'PLAN-3'}}]
        jira = FakeJira((r'issuetype = 10002', [linked]))
        work = self.work(jira)
        self.assertEqual([item['key'] for item in work.dependencies['PLAN-1']], ['PLAN-2', 'PLAN-3'])
        self.assertEqual(len(jira.calls), 1)


class CalculationTests(unittest.TestCase):
    def test_story_point_aggregate_keeps_source_values_and_matches_oracle(self):
        rows = [{'key': f'PLAN-{n}', 'fields': {POINTS: value}}
                for n, value in enumerate(ref.SP_SOURCE_VALUES, 1)]
        before = deepcopy(rows)
        self.assertEqual(pw.sum_story_points(rows, POINTS), ref.SP_EXPECTED_TOTAL)
        self.assertEqual(rows, before)  # null/''/'n/a' are not coerced to 0 server-side
        self.assertIsNone(rows[0]['fields'][POINTS])

    def test_allocation_override_order_and_inaccessible_parent_is_unavailable(self):
        work = pw.PlanningWork()
        leaf = epic('PLAN-1', parent='PLAN-I1')
        work.issues = [leaf]
        work.parent_state = {'PLAN-1': 'unavailable'}
        self.assertEqual(pw.resolve_allocation(work, leaf, ALLOCATION), ('unavailable', None))
        explicit = epic('PLAN-2', parent='PLAN-I1', allocation='x')
        self.assertEqual(pw.resolve_allocation(work, explicit, ALLOCATION), ('value', 'x'))
        work.parent_state = {'PLAN-1': 'readable'}
        work.parents = {'PLAN-I1': {'key': 'PLAN-I1', 'fields': {ALLOCATION: 'init', 'parent': {'key': 'PLAN-O1'}}}}
        self.assertEqual(pw.resolve_allocation(work, leaf, ALLOCATION), ('value', 'init'))
        work.parents['PLAN-I1']['fields'][ALLOCATION] = None
        self.assertEqual(pw.resolve_allocation(work, leaf, ALLOCATION), ('unavailable', None))
        work.ancestors = {'PLAN-O1': {'key': 'PLAN-O1', 'fields': {ALLOCATION: 'obj'}}}
        self.assertEqual(pw.resolve_allocation(work, leaf, ALLOCATION), ('value', 'obj'))

    def test_killed_off_incomplete_counts_oracle_is_unchanged_by_the_facade(self):
        rows = [{'key': story['key'], 'fields': {POINTS: story['fields']['customfield_10004'],
                                                 'status': story['fields']['status']}}
                for story in ref.KILLED_INCOMPLETE_TASKS
                if story['fields']['status']['name'] != 'Killed']
        self.assertEqual(pw.sum_story_points(rows, POINTS), ref.KILLED_INCOMPLETE_EXPECTED_EPIC_TOTAL)


class ComponentCohortJira:
    """Fake Jira holding the paired fixture; evaluates component / key membership."""

    def __init__(self):
        self.leaves = [
            epic('PLAN-E1', parent='PLAN-I1', points=8, components=('Component A',)),
            epic('PLAN-E2', parent='PLAN-I1', points=5, components=('Component B',)),
        ]
        self.initiatives = [parent_issue('PLAN-I1')]
        self.calls = []

    def search(self, payload):
        self.calls.append(payload['jql'])
        jql = payload['jql']
        if 'component in' in jql:
            wanted = set(re.findall(r'"(Component [A-Z])"', jql))
            rows = [row for row in self.leaves
                    if wanted & {c['name'] for c in row['fields']['components']}]
        else:
            keys = set(re.findall(r'"(PLAN-[A-Z0-9]+)"', jql))
            rows = [row for row in self.initiatives if row['key'] in keys]
        return {'issues': rows, 'isLast': True}


class ComponentCohortTests(unittest.TestCase):
    def cohort(self, components, jira=None):
        jira = jira or ComponentCohortJira()
        selected = roles()
        return pw.admit_component_cohort(selected, jira.search, lambda: None, components), jira

    def test_a_only_admits_the_initiative_once_with_only_matching_epic(self):
        expected = ref.NEW_MODEL_COMPONENT_BOARD['expected'][('Component A',)]
        cohort, jira = self.cohort(['Component A'])
        self.assertEqual(cohort.parent_keys(), expected['initiatives'])
        self.assertEqual(sorted(cohort.leaves), expected['epics'])
        self.assertEqual(pw.sum_story_points(cohort.leaves.values(), POINTS), expected['story_points'])
        self.assertNotIn('PLAN-E2', ' '.join(jira.calls))
        # Membership never consults the parent's own Components or a text-swapped parent query.
        self.assertTrue(all('component' not in call for call in jira.calls[1:]))

    def test_a_plus_b_admits_both_once(self):
        expected = ref.NEW_MODEL_COMPONENT_BOARD['expected'][('Component A', 'Component B')]
        cohort, _jira = self.cohort(['Component A', 'Component B'])
        self.assertEqual(cohort.parent_keys(), expected['initiatives'])
        self.assertEqual(sorted(cohort.leaves), expected['epics'])
        self.assertEqual(pw.sum_story_points(cohort.leaves.values(), POINTS), expected['story_points'])

    def test_initiatives_own_components_do_not_admit_it(self):
        jira = ComponentCohortJira()
        jira.initiatives = [parent_issue('PLAN-I1', components=('Component C',))]
        cohort, _ = self.cohort(['Component C'], jira)
        self.assertEqual(cohort.leaves, {})
        self.assertEqual(cohort.parent_keys(), [])

    def test_inaccessible_parent_keeps_the_readable_leaf(self):
        jira = ComponentCohortJira()
        jira.initiatives = []
        cohort, _ = self.cohort(['Component A'], jira)
        self.assertEqual(cohort.inaccessible_parents, {'PLAN-I1'})
        self.assertEqual(sorted(cohort.leaves), ['PLAN-E1'])
        shell = pw.orphan_parent_shell('PLAN-I1')
        self.assertEqual(shell['key'], 'PLAN-I1')

    def test_team_filter_applies_to_epic_leaves_not_initiative_team(self):
        selected = roles()
        jql = pw.build_leaf_component_jql(selected, ['Component A'], team_ids=['t1'])
        self.assertIn('cf[30101] = "t1"', jql)
        self.assertIn('issuetype = 10002', jql)
        self.assertNotIn('10001', jql)

    def test_empty_component_selection_is_incomplete_configuration(self):
        with self.assertRaises(ws.WorkConfigError):
            pw.build_leaf_component_jql(roles(), [])


class AlertDerivationTests(unittest.TestCase):
    def child(self, key, status, sprints=()):
        return {'key': key, 'fields': {'status': {'name': status}, SPRINT: [{'id': s} for s in sprints]}}

    def test_partial_source_never_yields_requirements(self):
        self.assertIsNone(pw.derive_parent_alert_state([], selected_sprint_id='5', sprint_field_id=SPRINT,
                                                       complete=False))

    def test_empty_ready_to_close_postponed_and_waiting_from_epic_children(self):
        derive = lambda kids: pw.derive_parent_alert_state(
            kids, selected_sprint_id='5', sprint_field_id=SPRINT, complete=True)
        self.assertTrue(derive([])['empty'])
        self.assertFalse(derive([])['readyToClose'])
        self.assertTrue(derive([self.child('E1', 'Done', (5,))])['readyToClose'])
        # A future open Epic prevents closure and routes as postponed.
        pending = derive([self.child('E1', 'Done', (5,)), self.child('E2', 'To Do', (9,))])
        self.assertFalse(pending['readyToClose'])
        future_only = derive([self.child('E2', 'To Do', (9,))])
        self.assertTrue(future_only['postponed'])
        self.assertTrue(future_only['empty'])
        self.assertTrue(derive([self.child('E3', 'Blocked', (5,))])['waiting'])

    def test_discovery_statuses_exclude_terminal_before_the_ceiling(self):
        self.assertEqual(pw.discovery_excluded_statuses(readiness=False), ('Done', 'Killed', 'Incomplete'))
        self.assertEqual(pw.discovery_excluded_statuses(readiness=True),
                         ('Done', 'Killed', 'Incomplete', 'Postponed'))
        jql = roles().parent_search_jql(
            terminal_statuses=pw.discovery_excluded_statuses(readiness=True))
        self.assertIn('issuetype = 10001', jql)
        self.assertIn('status not in ("Done", "Killed", "Incomplete", "Postponed")', jql)


if __name__ == '__main__':
    unittest.main()
