"""Pure authoritative inclusion compilation and task-reader discovery parity."""
from copy import deepcopy
import unittest

from backend.services import planning_scope as scope
from tests.test_planning_work_profiles import context, bundle


class PlanningScopeTests(unittest.TestCase):
    def compile(self, *, config=None, group=None, sprint=None, work=None):
        return scope.compile_planning_inclusion_scope(
            config or {'base_jql': 'project = "SYN" ORDER BY created DESC',
                       'team_jql_template': '', 'issue_types': ['Story']},
            group or {'id': 'synthetic-department', 'teamIds': ['alpha', 'beta']},
            sprint or {'id': '101', 'name': '2027Q1'}, work)

    def test_legacy_default_custom_and_unrestricted_types(self):
        for names, clause in [(None, 'type = "Story"'), (['Story'], 'type = "Story"'),
                              (['Task', 'Bug'], 'type in ("Task", "Bug")'), ([], '')]:
            config = {'base_jql': 'project = "SYN"', 'team_jql_template': ''}
            if names is not None:
                config['issue_types'] = names
            result = self.compile(config=config)
            expected = 'project = "SYN" AND "Team[Team]" in ("alpha", "beta") AND Sprint = 101'
            self.assertEqual(result['candidate_jql'], expected + (' AND ' + clause if clause else ''))
            self.assertEqual(result['child_kind'], 'story')
        self.assertNotIn('issuetype !=', self.compile(config={'base_jql': '', 'issue_types': []})['candidate_jql'])

    def test_null_types_default_and_empty_department_preserves_base_scope(self):
        result = self.compile(config={'base_jql': 'project = SYN AND "Team[Team]" = "base"',
                                      'issue_types': None, 'team_jql_template': 'labels = ignored'},
                              group={'id': 'synthetic', 'teamIds': []})
        self.assertEqual(result['candidate_jql'],
                         'project = SYN AND "Team[Team]" = "base" AND Sprint = 101 AND type = "Story"')

    def test_team_normalization_and_existing_base_team_replacement(self):
        result = self.compile(config={'base_jql': 'project = SYN AND "Team[Team]" = "old" ORDER BY created DESC',
                                      'issue_types': []}, group={'teamIds': [' alpha ', '', 'alpha', None, 'beta']})
        self.assertEqual(result['candidate_jql'],
                         'project = SYN AND "Team[Team]" in ("alpha", "beta") AND Sprint = 101 ORDER BY created DESC')

    def test_template_is_authoritative_including_label_and_component_clauses(self):
        template = 'component = "Synthetic component" AND labels = "synthetic-label" AND "Team[Team]" in ({TEAM_IDS}) ORDER BY rank ASC'
        result = self.compile(config={'base_jql': 'project = IGNORED', 'team_jql_template': template, 'issue_types': []})
        self.assertEqual(result['candidate_jql'], template.replace('{TEAM_IDS}', '"alpha", "beta"').replace(' ORDER BY', ' AND Sprint = 101 ORDER BY'))
        base = self.compile(config={'base_jql': 'component = "Synthetic component" AND labels = "synthetic-label"', 'issue_types': []})
        self.assertIn('component = "Synthetic component" AND labels = "synthetic-label"', base['candidate_jql'])

    def test_readiness_labels_components_and_parent_placeholders_do_not_widen_scope(self):
        group = {'id': 'synthetic-department', 'teamIds': ['alpha', 'beta']}
        clean = self.compile(group=group)
        group.update(teamLabels={'alpha': ['alias']}, missingInfoComponents=['readiness-only'],
                     requirements=[{'issueId': '999'}], parentIds=['998'])
        self.assertEqual(self.compile(group=group), clean)
        self.assertNotIn('999', clean['candidate_jql'])

    def test_resolved_hierarchy_and_mapped_fields(self):
        work = context()
        result = self.compile(work=work)
        self.assertEqual(result['candidate_jql'],
                         'project = "SYN" AND cf[30101] in ("alpha", "beta") AND cf[10101] = 101 AND issuetype = 10002 ORDER BY created DESC')
        self.assertEqual(result['child_kind'], 'epic')
        self.assertNotIn('10001', result['candidate_jql'])
        legacy = context('2026Q4', bundle(legacy_payload={'issueTypes': []}))
        self.assertNotIn('type =', self.compile(work=legacy)['candidate_jql'])
        self.assertEqual(self.compile(work=legacy)['child_kind'], 'story')

    def test_inputs_unchanged_and_digest_is_semantic_and_deterministic(self):
        config = {'base_jql': 'project = SYN', 'issue_types': ['Story']}
        group = {'id': 'synthetic', 'teamIds': ['alpha']}
        sprint = {'id': '101', 'name': '2027Q1'}
        original = deepcopy((config, group, sprint))
        first = self.compile(config=config, group=group, sprint=sprint)
        self.assertEqual(first, self.compile(config=config, group=group, sprint=sprint))
        self.assertEqual(len(first['scope_digest']), 64)
        self.assertEqual((config, group, sprint), original)
        sprint['id'] = '102'
        self.assertNotEqual(first['scope_digest'], self.compile(config=config, group=group, sprint=sprint)['scope_digest'])

    def test_literal_or_and_order_quirks_match_existing_reader(self):
        result = self.compile(config={'base_jql': 'labels = a OR labels = b ORDER BY created DESC', 'issue_types': []})
        self.assertEqual(result['candidate_jql'], 'labels = a OR labels = b AND "Team[Team]" in ("alpha", "beta") AND Sprint = 101 ORDER BY created DESC')
        # Lowercase order by is intentionally not normalized by the legacy builder.
        self.assertEqual(scope.append_discovery_clause('project = SYN order by rank', 'Sprint = 101'),
                         'project = SYN order by rank AND Sprint = 101')

    def test_lowercase_or_malformed_ordering_cannot_drop_admission_filters(self):
        for base in ('project = SYN order by rank',
                     'project = SYN ORDER BY rank AND Sprint = 999',
                     'project = SYN ORDER BY rank OR type = Task'):
            with self.subTest(base=base), self.assertRaises(ValueError):
                self.compile(config={'base_jql': base, 'issue_types': ['Story']})
        # No intersection query can be sent for an out-of-Team/Sprint/type id.
        malformed = scope.build_task_discovery_jql('project = SYN order by rank', ['alpha'], '101')
        malformed = scope.append_task_planning_clause(malformed, issue_types=['Story'])
        with self.assertRaises(ValueError):
            scope.planning_candidate_intersection_jql(['999'], malformed)

    def test_unbalanced_predicates_cannot_escape_requested_id_intersection(self):
        for query in ('project = SYN) OR id = 999 OR (project = SYN',
                      '(project = SYN', 'project = SYN)', 'labels = "unterminated',
                      "labels = 'unterminated", 'project = SYN ORDER BY "unterminated',
                      'project = SYN ORDER BY rank) OR id = 999'):
            with self.subTest(query=query), self.assertRaises(ValueError):
                scope.planning_candidate_intersection_jql(['8101'], query)
        query = '(labels = "ORDER BY literal" OR component = "x") ORDER BY rank ASC, "Story Points" DESC, cf[10004]'
        self.assertEqual(scope.planning_candidate_intersection_jql(['8101'], query),
                         'id in (8101) AND ((labels = "ORDER BY literal" OR component = "x"))')

    def test_unsafe_team_data_cannot_become_an_admission_clause(self):
        for team in ('alpha") OR id = 999 OR ("Team[Team]" = "alpha',
                     'alpha" OR Sprint = 999 OR type = "Task',
                     'alpha\\', 'alpha\n', "alpha'"):
            for work, template in ((None, ''), (context(), ''),
                                   (None, 'project = SYN AND "Team[Team]" in ({TEAM_IDS})')):
                with self.subTest(team=team, template=template), self.assertRaises(ValueError):
                    self.compile(group={'teamIds': [team]}, work=work,
                                 config={'base_jql': 'project = SYN', 'issue_types': ['Story'],
                                         'team_jql_template': template})

    def test_id_intersection_removes_only_top_level_order_and_groups_candidate(self):
        query = 'labels = "ORDER BY literal" OR component = "x" order by rank ASC'
        self.assertEqual(scope.planning_candidate_intersection_jql(['8101', '8102'], query),
                         'id in (8101,8102) AND (labels = "ORDER BY literal" OR component = "x")')
        with self.assertRaises(ValueError):
            scope.planning_candidate_intersection_jql(['1) OR project = OTHER'], query)
        with self.assertRaises(ValueError):
            scope.planning_candidate_intersection_jql([], query)
        with self.assertRaises(ValueError):
            scope.planning_candidate_intersection_jql([str(i) for i in range(1, 502)], query)


if __name__ == '__main__':
    unittest.main()
