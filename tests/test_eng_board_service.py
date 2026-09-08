import ast
import pathlib
import unittest
from unittest.mock import patch

from backend.services import eng_board


ROOT = pathlib.Path(__file__).resolve().parents[1]


def issue(key, *, status='To Do', project_key='PROD', project_name='Product', parent=None,
          epic_link=None, issue_type='Story'):
    fields = {
        'summary': key,
        'status': {'id': '1', 'name': status},
        'priority': {'id': '2', 'name': 'Medium'},
        'assignee': None,
        'updated': '2026-09-08T00:00:00.000+0000',
        'project': {'id': '3', 'key': project_key, 'name': project_name},
        'parent': ({'key': parent, 'fields': {
            'summary': parent, 'issuetype': {'id': '4', 'name': 'Epic'},
        }} if parent else None),
        'issuetype': {'id': '5', 'name': issue_type},
    }
    if epic_link is not None:
        fields['customfield_10014'] = epic_link
    return {'key': key, 'fields': fields}


class EngBoardScopeTests(unittest.TestCase):
    def test_project_profiles_include_other_and_saved_board_fallback(self):
        cases = (
            ([{'key': 'prod', 'type': 'product'}, {'key': 'ops', 'type': 'other'}], None,
             (('PROD', 'product'), ('OPS', 'other'))),
            ([], ' legacy ', (('LEGACY', 'fallback'),)),
        )
        for selected, fallback, expected in cases:
            with self.subTest(selected=selected, fallback=fallback):
                self.assertEqual(expected, eng_board.normalize_projects(selected, saved_board_project_key=fallback))

    def test_epic_link_resolution_requires_the_schema_identity_not_a_display_name(self):
        catalog = [
            {'id': 'customfield_99999', 'name': 'Epic Link', 'schema': {'custom': 'vendor:unrelated'}},
            {'id': 'customfield_10014', 'name': 'Relationship',
             'schema': {'custom': 'com.pyxis.greenhopper.jira:gh-epic-link'}},
        ]
        self.assertEqual('customfield_10014', eng_board.resolve_epic_link_field(catalog))
        self.assertIsNone(eng_board.resolve_epic_link_field(catalog[:1]))

    def test_conflicting_project_types_are_rejected(self):
        with self.assertRaisesRegex(eng_board.EngBoardError, 'board_project_scope_required'):
            eng_board.normalize_projects([{'key': 'A', 'type': 'product'}, {'key': 'a', 'type': 'tech'}])

    def test_project_classification_is_typed_or_product_first_fallback(self):
        other = issue('OPS-1', project_key='OPS', project_name='Operations')['fields']
        self.assertEqual('other', eng_board.classify_project(other, (('OPS', 'other'),)))
        fallback = (('OPS', 'fallback'),)
        self.assertEqual('product', eng_board.classify_project(
            other, fallback, fallback_product_projects=('Operations',), fallback_tech_projects=('Operations',),
        ))
        self.assertEqual('other', eng_board.classify_project(other, fallback))

    def test_component_and_team_profiles_build_only_their_settled_predicates(self):
        projects = (('PROD', 'product'), ('TECH', 'tech'))
        index = eng_board.build_epic_index_jql(projects, ('Shared',), (), 28)
        self.assertIn('project in ("PROD","TECH")', index)
        self.assertEqual(1, index.count('"Shared"'))
        self.assertIn('component in ("Shared")', index)
        child = eng_board.build_child_jql(
            projects, ('10001', '10002'), ('PROD-1',), sprint_id=91, team_ids=('team-a', 'team-b'),
        )
        self.assertIn('issuetype in ("10001","10002")', child)
        self.assertIn('cf[10101] = 91', child)
        self.assertIn('cf[30101] in ("team-a","team-b")', child)
        self.assertNotIn('component', child.lower())

    def test_query_values_are_escaped_and_retention_uses_history_and_created_not_updated(self):
        jql = eng_board.build_epic_index_jql(
            (('PR"OD', 'product'),), ('Shared "name"',), ('Done "again"',), 1,
        )
        self.assertIn('"PR\\"OD"', jql)
        self.assertIn('"Shared \\"name\\""', jql)
        self.assertIn('status CHANGED TO "Done \\"again\\"" AFTER -1d', jql)
        self.assertIn('created >= -1d', jql)
        self.assertNotIn('updated', jql)

    def test_retention_1_28_90_and_empty_terminal_status(self):
        for days in (1, 28, 90):
            with self.subTest(days=days):
                jql = eng_board.build_epic_index_jql((('P', 'product'),), (), ('Done',), days)
                self.assertIn(f'AFTER -{days}d', jql)
                self.assertIn(f'created >= -{days}d', jql)
        no_terminal = eng_board.build_epic_index_jql((('P', 'product'),), (), (), 28)
        self.assertNotIn('status ', no_terminal)
        with self.assertRaisesRegex(eng_board.EngBoardError, 'board_config_invalid'):
            eng_board.build_epic_index_jql((('P', 'product'),), (), ('Done',), 91)

    def test_absent_board_is_selected_sprint_synthetic_shape(self):
        normalized = eng_board.normalize_board(None)
        self.assertFalse(normalized['configured'])
        self.assertIsNone(normalized['doneEpicRetentionDays'])
        self.assertEqual('board-unconfigured', normalized['columns'][0]['id'])

    def test_scope_configuration_requires_saved_board_and_components_only_for_all_work(self):
        board = {
            'columns': [{'id': 'col-00000001', 'name': 'To do', 'statuses': ['To Do']}],
            'doneEpicRetentionDays': 28,
        }
        cases = (
            ('all_work', None, ('Shared',), 'board_config_invalid'),
            ('all_work', board, (), 'board_components_required'),
            ('all_work', board, (' Shared ', 'Shared'), None),
            ('sprint', None, (), None),
        )
        for scope, raw_board, components, error_code in cases:
            with self.subTest(scope=scope, board=raw_board is not None, components=components):
                if error_code:
                    with self.assertRaisesRegex(eng_board.EngBoardError, error_code):
                        eng_board.validate_scope_configuration(scope, raw_board, components)
                    continue
                result = eng_board.validate_scope_configuration(scope, raw_board, components)
                self.assertEqual(scope, result['scope'])
                self.assertEqual(tuple(dict.fromkeys(value.strip() for value in components)), result['components'])
                self.assertEqual(raw_board is not None, result['board']['configured'])

    def test_scope_cohort_digest_tracks_config_but_excludes_token_rotation(self):
        captured = {
            'workspace_id': 'workspace-a',
            'site_id': 'cloud-a',
            'user_id': 'user-a',
            'department_id': 'department-a',
            'shared_config_revisions': {'groups': 7, 'dashboard': 11},
            'shared_config_content': {'groupName': 'Platform'},
            'effective_projects': (('PROD', 'product'),),
            'project_access': ({'projectKey': 'PROD', 'status': 'allowed'},),
            'fields': {'sprint': 'customfield_10101', 'team': 'customfield_30101'},
            'eligible_issue_types': ('10001',),
            'components': ('Shared',),
            'teams': ('team-a',),
            'board': {'columns': ({'id': 'col-00000001', 'statuses': ('To Do',)},),
                      'doneEpicRetentionDays': 28},
            'scope': 'all_work',
            'sprint_id': None,
        }
        first = eng_board.build_scope_cohort_digest(b'server-secret', **captured)
        rotated_token_version = eng_board.build_scope_cohort_digest(b'server-secret', **captured)
        self.assertRegex(first, r'^[0-9a-f]{64}$')
        self.assertEqual(first, rotated_token_version)

        changed_components = {**captured, 'components': ('Shared', 'Backend')}
        changed_board = {**captured, 'board': {
            **captured['board'], 'doneEpicRetentionDays': 90,
        }}
        self.assertNotEqual(first, eng_board.build_scope_cohort_digest(b'server-secret', **changed_components))
        self.assertNotEqual(first, eng_board.build_scope_cohort_digest(b'server-secret', **changed_board))

    def test_configured_non_story_types_resolve_by_catalog(self):
        catalog = [
            {'id': '10', 'name': 'Story', 'hierarchyLevel': 0, 'subtask': False},
            {'id': '11', 'name': 'Task', 'hierarchyLevel': 0, 'subtask': False},
            {'id': '12', 'name': 'Subtask', 'hierarchyLevel': -1, 'subtask': True},
        ]
        self.assertEqual(('11',), eng_board.resolve_issue_type_ids(catalog, ['Task'], key_present=True))
        self.assertEqual(('10', '11'), eng_board.resolve_issue_type_ids(catalog, [], key_present=True))


class EngBoardPagingTests(unittest.TestCase):
    def test_empty_nonfinal_page_continues_and_callback_sees_only_validated_pages(self):
        bodies = iter((
            {'issues': [], 'isLast': False, 'nextPageToken': 'next'},
            {'issues': [issue('P-1')], 'isLast': True},
        ))
        pages = []
        result = eng_board.strict_search(lambda _payload: next(bodies), 'project = "P"', ('summary',), on_page=pages.append)
        self.assertEqual(['P-1'], [row['key'] for row in result])
        self.assertEqual([(), ('P-1',)], pages)

    def test_page_callback_never_receives_arbitrary_jira_fields(self):
        pages = []
        eng_board.strict_search(
            lambda _payload: {'issues': [{'key': 'P-1', 'fields': {'secret': 'not-projected'}}], 'isLast': True},
            'project = "P"', ('summary',), on_page=pages.append,
        )
        self.assertEqual([('P-1',)], pages)

    def test_malformed_paging_duplicate_keys_and_repeated_tokens_raise(self):
        cases = (
            [{'issues': [], 'isLast': 'yes'}],
            [{'issues': [issue('p-1'), issue(' P-1 ')], 'isLast': True}],
            [
                {'issues': [], 'isLast': False, 'nextPageToken': 'same'},
                {'issues': [], 'isLast': False, 'nextPageToken': 'same'},
            ],
        )
        for bodies in cases:
            with self.subTest(bodies=bodies):
                iterator = iter(bodies)
                with self.assertRaisesRegex(eng_board.EngBoardError, 'board_projection_invalid'):
                    eng_board.strict_search(lambda _payload: next(iterator), 'project = "P"', ('summary',))

    def test_unique_key_limit_is_incremental_and_exact_limit_requires_completion(self):
        published = []
        with self.assertRaisesRegex(eng_board.EngBoardError, 'board_scope_too_large'):
            eng_board.strict_search(
                lambda _payload: {'issues': [issue('P-1'), issue('P-2')], 'isLast': False, 'nextPageToken': 'more'},
                'project = "P"', ('summary',), max_unique_keys=2, on_page=published.append,
            )
        self.assertEqual([], published)
        result = eng_board.strict_search(
            lambda _payload: {'issues': [issue('P-1'), issue('P-2')], 'isLast': True},
            'project = "P"', ('summary',), max_unique_keys=2,
        )
        self.assertEqual(2, len(result))

    def test_shared_budget_rejects_cross_search_duplicate_and_global_overflow_before_publish(self):
        budget = eng_board.UniqueKeyBudget(2)
        eng_board.strict_search(
            lambda _payload: {'issues': [issue('P-1')], 'isLast': True},
            'project = "P"', ('summary',), key_budget=budget,
        )
        published = []
        with self.assertRaisesRegex(eng_board.EngBoardError, 'board_projection_invalid'):
            eng_board.strict_search(
                lambda _payload: {'issues': [issue('p-1')], 'isLast': True},
                'project = "P"', ('summary',), key_budget=budget, on_page=published.append,
            )
        self.assertEqual([], published)

    def test_partial_result_helpers_are_not_imported(self):
        source = (ROOT / 'backend/services/eng_board.py').read_text(encoding='utf-8')
        tree = ast.parse(source)
        names = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
        self.assertNotIn('fetch_issues_by_jql', names)
        self.assertNotIn('fetch_issues_by_keys', names)
        self.assertNotIn('fetch_epic_details_bulk', names)


class EngBoardProjectionTests(unittest.TestCase):
    def setUp(self):
        self.columns = (
            {'id': 'col-open', 'statuses': ('To Do',)},
            {'id': 'col-done', 'statuses': ('Done',)},
        )
        self.epics = [issue('P-1'), issue('P-2', status='Unexpected')]

    def test_all_work_keeps_zero_child_epic_but_sprint_qualification_drops_it(self):
        children = [issue('P-10', parent='P-1', issue_type='Task')]
        all_work = eng_board.project_board(self.epics, children, project_map=(('PROD', 'product'),), columns=self.columns)
        sprint = eng_board.project_board(
            self.epics, children, project_map=(('PROD', 'product'),), columns=self.columns, require_children=True,
        )
        self.assertEqual(['P-1', 'P-2'], [row['key'] for row in all_work['epics']])
        self.assertEqual(['P-1'], [row['key'] for row in sprint['epics']])
        self.assertEqual('Task', sprint['epics'][0]['children'][0]['issueType']['name'])

    def test_unknown_status_is_unmapped_and_epic_link_precedes_parent(self):
        children = [issue('P-10', parent='P-2', epic_link='P-1')]
        result = eng_board.project_board(
            self.epics, children, project_map=(('PROD', 'product'),), columns=self.columns,
            epic_link_field_id='customfield_10014',
        )
        by_key = {row['key']: row for row in result['epics']}
        self.assertEqual('board-unmapped', by_key['P-2']['columnId'])
        self.assertEqual(['P-10'], [row['key'] for row in by_key['P-1']['children']])
        self.assertEqual([], by_key['P-2']['children'])

    def test_projection_retains_closed_wire_identity_and_numeric_fields(self):
        epic = issue('P-1')
        epic['fields']['assignee'] = {
            'accountId': 'account-1', 'displayName': 'Owner',
            'avatarUrls': {'48x48': 'https://example.invalid/avatar.png'},
        }
        child = issue('P-10', parent='P-1', issue_type='Task')
        child['fields'].update({
            'customfield_10004': 3.5,
            'customfield_10101': [{'id': 42}, {'id': '43'}],
            'customfield_30101': {'id': 'team-1', 'name': 'Team One'},
        })
        result = eng_board.project_board(
            [epic], [child], project_map=(('PROD', 'product'),), columns=self.columns,
        )['epics'][0]
        self.assertEqual('account-1', result['assignee']['accountId'])
        self.assertEqual('https://example.invalid/avatar.png', result['assignee']['avatarUrl'])
        self.assertIsNone(result['parent'])
        self.assertEqual([42, 43], result['children'][0]['sprintIds'])
        self.assertEqual(3.5, result['children'][0]['storyPoints'])
        self.assertEqual({'id': 'team-1', 'name': 'Team One'}, result['children'][0]['team'])

    def test_projection_rejects_malformed_required_identity_without_type_errors(self):
        malformed = issue('P-1')
        malformed['fields']['status'] = []
        with self.assertRaisesRegex(eng_board.EngBoardError, 'board_projection_invalid'):
            eng_board.project_board(
                [malformed], [], project_map=(('PROD', 'product'),), columns=self.columns,
            )


if __name__ == '__main__':
    unittest.main()
