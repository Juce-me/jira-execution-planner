"""EPM under the quarterly work configuration (plan Task 6A): selector admission and the new-model rollup."""
import re
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import jira_server
from backend.epm import rollup as epm_rollup
from backend.epm.scope import build_epm_scope_clause
from backend.routes import work_structure_routes as work_routes
from backend.services import planning_work
from backend.services import work_structure as ws
from tests.test_work_structure_routes import WorkStructureRouteBase

INITIATIVE_TYPE = {'id': '10001', 'name': 'Initiative'}
EPIC_TYPE = {'id': '10002', 'name': 'Delivery Epic'}


def promoted_snapshot():
    bundle = ws.capture_virtual_bundle({})
    for entry in bundle['configurations']:
        entry['revision'] = 1
    bundle['promotionRevision'] = 3
    legacy, delivery = bundle['configurations']
    legacy['scope']['projects'] = [{'key': 'OLD', 'type': 'product'}]
    legacy['scope']['boardId'] = '7001'
    delivery['scope']['projects'] = [{'key': 'PLAN', 'type': 'other'}]
    delivery['hierarchy'].update(planningIssueTypeId='10002', parentIssueTypeId='10001')
    for name in ('sprint', 'storyPoints', 'team'):
        delivery['fields'][name] = {'fieldId': f'customfield_2{len(name)}', 'fieldName': name}
    return SimpleNamespace(payload={'version': 1, 'workConfigurations': bundle})


def roles_for(quarter):
    snapshot = promoted_snapshot()
    return planning_work.WorkRoles(ws.resolve_work_configuration(snapshot, quarter=quarter, flag_enabled=True))


def raw_issue(key, issue_type, parent=None, status='To Do', sprint=None, points=None):
    fields = {'summary': key, 'status': {'name': status}, 'issuetype': dict(issue_type), 'labels': ['rnd_project_x'],
              'customfield_211': points}
    if parent:
        fields['parent'] = {'key': parent, 'fields': {'summary': parent, 'issuetype': dict(INITIATIVE_TYPE)}}
    if sprint:
        fields['customfield_26'] = [{'id': sprint, 'name': '2027Q1', 'state': 'active'}]
    return {'key': key, 'id': key[-1], 'fields': fields}


def deps_for(roles, responders, calls, issue_types=None):
    def fetch(jql, name, headers, fields_list, truncated):
        calls.append((name, jql, list(fields_list)))
        for pattern, rows in responders:
            if re.search(pattern, jql):
                return rows
        return []

    return epm_rollup.EpmRollupDependencies(
        find_epm_project_or_404=lambda project_id: {'id': project_id, 'label': 'rnd_project_x', 'name': 'X'},
        normalize_epm_text=jira_server.normalize_epm_text,
        validate_epm_tab_sprint=jira_server.validate_epm_tab_sprint,
        build_empty_epm_rollup_payload=jira_server.build_empty_epm_rollup_payload,
        build_base_jql=lambda: roles.base_jql(''),
        add_clause_to_jql=jira_server.add_clause_to_jql,
        build_jira_headers=lambda: {},
        resolve_epic_link_field_id=lambda headers: None,
        resolve_team_field_id=lambda headers: roles.team_field_id,
        build_epm_rollup_fields_list=lambda epic_link=None, team=None: ['summary', 'customfield_211', 'customfield_26'],
        get_epm_config=lambda: {'issueTypes': issue_types or {'initiative': ['PrivateInit'], 'epic': ['PrivateEpic'], 'leaf': []}},
        normalize_epm_issue_type_sets=jira_server.normalize_epm_issue_type_sets,
        fetch_epm_rollup_query=fetch,
        shape_epm_rollup_issue_payload=lambda issues, epic_link_field_id=None, team_field_id=None:
            jira_server.shape_epm_rollup_issue_payload(
                issues, epic_link_field_id=epic_link_field_id, team_field_id=team_field_id,
                story_points_field_id='customfield_211', sprint_field_id='customfield_26'),
        dedupe_issues_by_key=jira_server.dedupe_issues_by_key,
        build_epm_rollup_hierarchy=jira_server.build_epm_rollup_hierarchy,
        cache={}, cache_lock=threading.Lock(), cache_ttl_seconds=60,
        roles=roles, sprint_clause=roles.sprint_clause,
    )


class NewModelRollupTests(unittest.TestCase):
    def setUp(self):
        self.roles = roles_for('2027Q1')
        self.calls = []

    def rollup(self, tab, sprint, responders, issue_types=None):
        deps = deps_for(self.roles, responders, self.calls, issue_types)
        return epm_rollup.build_per_project_rollup('p1', tab, sprint, deps)

    def test_active_reads_selected_sprint_epics_under_labeled_initiatives(self):
        initiatives = [raw_issue('PLAN-1', INITIATIVE_TYPE), raw_issue('PLAN-9', INITIATIVE_TYPE)]
        epics = [raw_issue('PLAN-11', EPIC_TYPE, parent='PLAN-1', sprint=5, points=8)]
        payload, status, _ = self.rollup('active', '5', [(r'labels = ', initiatives), (r'parent in', epics)])
        self.assertEqual(status, 200)
        self.assertEqual([name for name, *_ in self.calls], ['q1', 'q2'])  # no Story query: no daily Story prerequisite
        q1, q2 = self.calls[0][1], self.calls[1][1]
        self.assertIn('labels = "rnd_project_x"', q1)
        self.assertIn('issuetype = 10001', q1)
        self.assertIn('project in ("PLAN")', q1)
        self.assertIn('parent in ("PLAN-1", "PLAN-9")', q2)
        self.assertIn('issuetype = 10002', q2)
        self.assertIn('cf[26] = 5', q2)
        self.assertNotIn('Epic Link', q1 + q2)
        self.assertNotIn('Sprint =', q1 + q2)
        self.assertEqual(list(payload['initiatives']), ['PLAN-1'])  # the Initiative without a selected-quarter Epic is hidden
        epic = payload['initiatives']['PLAN-1']['epics']['PLAN-11']
        self.assertEqual(epic['issue']['storyPoints'], 8)
        self.assertEqual(epic['stories'], [])
        self.assertEqual(payload['hierarchyNames'], {'initiative': ['Initiative'], 'epic': ['Delivery Epic']})

    def test_private_issue_type_names_never_classify_a_new_period(self):
        initiatives = [raw_issue('PLAN-1', INITIATIVE_TYPE)]
        epics = [raw_issue('PLAN-11', EPIC_TYPE, parent='PLAN-1', sprint=5)]
        payload, _, _ = self.rollup('active', '5', [(r'labels = ', initiatives), (r'parent in', epics)])
        self.assertIn('PLAN-11', payload['initiatives']['PLAN-1']['epics'])  # config says PrivateInit/PrivateEpic

    def test_no_epic_in_the_selected_quarter_is_an_empty_rollup(self):
        payload, status, _ = self.rollup('active', '5', [(r'labels = ', [raw_issue('PLAN-1', INITIATIVE_TYPE)])])
        self.assertEqual(status, 200)
        self.assertTrue(payload['emptyRollup'])

    def test_unlabeled_project_is_an_empty_rollup_after_one_query(self):
        payload, _, _ = self.rollup('active', '5', [])
        self.assertTrue(payload['emptyRollup'])
        self.assertEqual([name for name, *_ in self.calls], ['q1'])

    def test_backlog_reads_unsprinted_epics_without_a_sprint_id(self):
        initiatives = [raw_issue('PLAN-1', INITIATIVE_TYPE)]
        epics = [raw_issue('PLAN-11', EPIC_TYPE, parent='PLAN-1'),
                 raw_issue('PLAN-12', EPIC_TYPE, parent='PLAN-1', status='In Progress')]
        payload, _, _ = self.rollup('backlog', '', [(r'labels = ', initiatives), (r'parent in', epics)])
        self.assertIn('cf[26] is EMPTY', self.calls[1][1])
        self.assertEqual(list(payload['initiatives']['PLAN-1']['epics']), ['PLAN-11'])

    def test_legacy_roles_keep_the_story_rollup_with_the_selected_sprint_clause(self):
        self.roles = roles_for('2026Q4')
        initiatives = [{'key': 'OLD-1', 'id': '1', 'fields': {'summary': 'OLD-1', 'status': {'name': 'To Do'},
                                                             'issuetype': {'id': '9', 'name': 'Epic'}, 'labels': []}}]
        self.rollup('active', '5', [(r'labels = ', initiatives)],
                    issue_types={'initiative': ['Initiative'], 'epic': ['Epic'], 'leaf': []})
        self.assertEqual(self.calls[0][0], 'q1')
        self.assertIn('labels = "rnd_project_x"', self.calls[0][1])
        self.assertTrue(any('Sprint = 5' in jql for _name, jql, _fields in self.calls[1:]))


class ScopeClauseTests(unittest.TestCase):
    def test_epic_link_is_dropped_outside_legacy(self):
        linkage = {'labels': ['rnd_project_x'], 'epicKeys': ['PLAN-1']}
        self.assertIn('"Epic Link"', build_epm_scope_clause(linkage))
        scoped = build_epm_scope_clause(linkage, epic_link=False)
        self.assertNotIn('Epic Link', scoped)
        self.assertIn('parent in ("PLAN-1")', scoped)


class EpmAdmissionTests(WorkStructureRouteBase):
    def setUp(self):
        super().setUp()
        self.promoted_seed()
        self.seen = {}

        def fake_all(tab, sprint, sub_goal_keys=None, work_request=None):
            self.seen['all'] = work_request
            return {'projects': [], 'duplicates': {}}, 200, {}

        def fake_issues(home_project_id, tab, sprint, sub_goal_keys=None, work_request=None):
            self.seen['issues'] = work_request
            return {'project': {}, 'issues': [], 'epics': {}}, 200, {}

        self.stack.enter_context(patch.object(jira_server, 'build_all_epm_projects_rollup', side_effect=fake_all))
        self.stack.enter_context(patch('backend.routes.epm_routes.build_epm_project_issues_response', side_effect=fake_issues,
                                       create=True))
        self.stack.enter_context(patch.object(jira_server, 'resolve_request_catalog_sources', return_value=[Mock()]))
        self.stack.enter_context(patch.object(
            work_routes, 'admit_sprint_source',
            side_effect=lambda auth, sources, sprint_id, configuration_id=None, quarter=None:
                (Mock(configuration_id='delivery'), {'id': int(sprint_id), 'name': '2027Q1'})
                if sprint_id == '5' else (_ for _ in ()).throw(work_routes.WorkConfigError('sprint_catalog_mismatch'))))

    def test_active_tab_admits_the_selected_sprint_id_to_its_configuration(self):
        response = self.client.get('/api/epm/projects/rollup/all?tab=active&sprint=5')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        request_context = self.seen['all']
        self.assertEqual((request_context.roles.configuration_id, request_context.context.quarter), ('delivery', '2027Q1'))

    def test_unknown_sprint_is_a_catalog_mismatch(self):
        response = self.client.get('/api/epm/projects/rollup/all?tab=active&sprint=99')
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'sprint_catalog_mismatch'))
        self.assertNotIn('all', self.seen)

    def test_malformed_sprint_keeps_its_existing_400(self):
        response = self.client.get('/api/epm/projects/rollup/all?tab=active&sprint=5%20OR%201')
        self.assertEqual((response.status_code, response.get_json()['error']), (400, 'sprint_not_numeric'))

    def test_backlog_needs_an_explicit_viewed_quarter(self):
        response = self.client.get('/api/epm/projects/rollup/all?tab=backlog')
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'configuration_required'))
        response = self.client.get('/api/epm/projects/rollup/all?tab=backlog&quarter=2027q1')
        self.assertEqual((response.status_code, response.get_json()['error']), (400, 'invalid_quarter'))
        response = self.client.get('/api/epm/projects/rollup/all?tab=backlog&quarter=2026Q4')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(self.seen['all'].roles.configuration_id, 'legacy')

    def test_incomplete_selected_configuration_is_409_for_that_era_only(self):
        from backend.db import models
        import json
        with self.factory() as session:
            row = session.query(models.WorkspaceDashboardConfig).one()
            payload = json.loads(json.dumps(row.payload))
            payload['workConfigurations']['configurations'][1]['fields']['sprint'] = {'fieldId': '', 'fieldName': ''}
            row.payload = payload
            session.commit()
        response = self.client.get('/api/epm/projects/rollup/all?tab=backlog&quarter=2027Q1')
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'configuration_incomplete'))
        self.assertEqual(self.client.get('/api/epm/projects/rollup/all?tab=backlog&quarter=2026Q4').status_code, 200)

    def test_per_project_routes_use_the_same_admission(self):
        built = []
        self.stack.enter_context(patch.object(
            jira_server, 'build_epm_rollup_dependencies',
            side_effect=lambda **kwargs: built.append(kwargs.get('work_request')) or object()))
        self.stack.enter_context(patch.object(
            jira_server, 'build_per_project_rollup', return_value=({'initiatives': {}}, 200, {}), create=True))
        response = self.client.get('/api/epm/projects/p1/rollup?tab=backlog')
        self.assertEqual((response.status_code, response.get_json()['error']), (409, 'configuration_required'))
        self.assertEqual(built, [])


class EpmCacheIdentityTests(unittest.TestCase):
    def test_structural_digest_joins_the_rollup_generation(self):
        legacy = jira_server.work_configuration_cache_segment(
            ws.resolve_work_configuration(promoted_snapshot(), quarter='2026Q4', flag_enabled=True))
        delivery = jira_server.work_configuration_cache_segment(
            ws.resolve_work_configuration(promoted_snapshot(), quarter='2027Q1', flag_enabled=True))
        self.assertNotEqual(legacy, delivery)
        snapshot = promoted_snapshot()
        snapshot.payload['workConfigurations']['configurations'][1]['hierarchy']['planningIssueTypeId'] = '10009'
        corrected = jira_server.work_configuration_cache_segment(
            ws.resolve_work_configuration(snapshot, quarter='2027Q1', flag_enabled=True))
        self.assertNotEqual(delivery, corrected)


if __name__ == '__main__':
    unittest.main()
